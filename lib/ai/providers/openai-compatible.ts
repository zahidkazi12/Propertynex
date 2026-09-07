import "server-only";

import { AiInvalidResponseError, AiTimeoutError, AiUnavailableError } from "@/lib/ai/errors";
import type { AiCompletionRequest, AiProvider } from "@/lib/ai/types";

/**
 * Any service that speaks the OpenAI chat-completions wire format.
 *
 * ── Why a second provider exists at all ─────────────────────────────────────
 *
 * Not because this application wants two vendors, but because "the provider must
 * be replaceable later" is only true if it has actually been replaced once.
 * `lib/otp/providers/` makes the same argument with `console`/`resend`/`twilio`:
 * a seam with one implementation behind it is a seam nobody has tested, and the
 * abstraction always turns out to be shaped like the single implementation.
 *
 * This one is the format the widest range of services accept — self-hosted
 * servers, gateways, and several hosted vendors — so it is the practical answer
 * to "we need to point this somewhere else on Monday". It is **not** a way to
 * reach Claude: `AI_PROVIDER=anthropic` is that, and it speaks Anthropic's own
 * API rather than a translation layer.
 *
 * ── Why the JSON constraint is weaker here, and why that is fine ───────────
 *
 * `response_format: { type: "json_object" }` is asked for rather than a strict
 * JSON Schema, because schema enforcement is unevenly implemented across the
 * services this format covers, and a request that 400s on a self-hosted server
 * is a worse failure than a reply that needs parsing. The schema still reaches
 * the model — it is in the system prompt — and `lib/ai/criteria.ts` validates
 * every field afterwards either way. Nothing about correctness depends on the
 * provider honouring anything.
 *
 * `AI_BASE_URL` is required for this provider and has no default: there is no
 * sensible one, and guessing would produce requests to somebody else's server.
 */

export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
};

export function createOpenAiCompatibleProvider(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): AiProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    name: OPENAI_COMPATIBLE_PROVIDER,
    model: config.model,

    async complete(request: AiCompletionRequest): Promise<string> {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: request.maxOutputTokens,
            messages: [
              { role: "system", content: request.system },
              ...request.messages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
            ],
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new AiTimeoutError(OPENAI_COMPATIBLE_PROVIDER, request.timeoutMs);
        }
        throw new AiUnavailableError(
          OPENAI_COMPATIBLE_PROVIDER,
          error instanceof Error ? error.message : "network error"
        );
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new AiUnavailableError(
          OPENAI_COMPATIBLE_PROVIDER,
          `HTTP ${response.status} ${detail}`
        );
      }

      let payload: ChatCompletionResponse;
      try {
        payload = (await response.json()) as ChatCompletionResponse;
      } catch {
        throw new AiInvalidResponseError(OPENAI_COMPATIBLE_PROVIDER, "response body was not JSON");
      }

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim() === "") {
        throw new AiInvalidResponseError(
          OPENAI_COMPATIBLE_PROVIDER,
          "response contained no message content"
        );
      }

      return text;
    },
  };
}
