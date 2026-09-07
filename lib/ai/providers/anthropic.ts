import "server-only";

import { AiInvalidResponseError, AiTimeoutError, AiUnavailableError } from "@/lib/ai/errors";
import type { AiCompletionRequest, AiProvider } from "@/lib/ai/types";

/**
 * Anthropic's Messages API, over `fetch`.
 *
 * ── Why raw HTTP and not the SDK ────────────────────────────────────────────
 *
 * The same decision `lib/otp/providers/resend.ts` documents, for the same two
 * reasons. It adds no dependency — the request is one JSON POST, and this
 * milestone's brief is explicit that unnecessary dependencies are not to be
 * introduced. And this is one of *two* providers behind one interface: the other
 * speaks a different wire format entirely, so an SDK here would make the two
 * implementations structurally dissimilar for no gain, when what makes the seam
 * comprehensible is that both are forty lines of the same shape.
 *
 * ── Structured output ───────────────────────────────────────────────────────
 *
 * `output_config.format` constrains the model to the JSON Schema the caller
 * supplies, so the reply is valid JSON of the right shape without a retry loop.
 * It is an optimisation and not the safety boundary: `lib/ai/criteria.ts`
 * re-validates every field with Zod regardless, because a schema honoured by the
 * provider is still a promise made by the thing being defended against.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * The key arrives as a constructor argument, is read from `process.env` in
 * `lib/ai/provider.ts` and nowhere else, and is never logged, echoed, returned,
 * or included in an error message. `AiUnavailableError` carries the HTTP status
 * and a bounded slice of the provider's own error text, which is written for an
 * operator and goes to the server console only.
 */

/** The API version header this wire format is pinned to. */
const ANTHROPIC_VERSION = "2023-06-01";

export const ANTHROPIC_PROVIDER = "anthropic";

/** Default endpoint. Overridable with `AI_BASE_URL` for a gateway or a proxy. */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * The default model.
 *
 * Overridable with `AI_MODEL`. Any Claude model works — the request carries no
 * model-specific parameters (no thinking configuration, no effort, no beta
 * headers), which is deliberate: this provider should keep working when the
 * configured model is changed, and a parameter that only some models accept
 * would turn a model swap into a 400.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";

type AnthropicContentBlock = { type?: string; text?: string };
type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
};

export function createAnthropicProvider(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): AiProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  return {
    name: ANTHROPIC_PROVIDER,
    model: config.model,

    async complete(request: AiCompletionRequest): Promise<string> {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            output_config: {
              format: { type: "json_schema", schema: request.jsonSchema },
            },
          }),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (error) {
        // `AbortSignal.timeout` rejects with a TimeoutError DOMException; every
        // other rejection here is a network-level fault. Distinguished because
        // the visitor is told different things.
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new AiTimeoutError(ANTHROPIC_PROVIDER, request.timeoutMs);
        }
        throw new AiUnavailableError(
          ANTHROPIC_PROVIDER,
          error instanceof Error ? error.message : "network error"
        );
      }

      if (!response.ok) {
        // Read for the log, bounded: it is provider text and never reaches a
        // client. A 401 here means the configured key is wrong, which reads as
        // "unavailable" to a visitor and as a specific status to an operator.
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new AiUnavailableError(ANTHROPIC_PROVIDER, `HTTP ${response.status} ${detail}`);
      }

      let payload: AnthropicResponse;
      try {
        payload = (await response.json()) as AnthropicResponse;
      } catch {
        throw new AiInvalidResponseError(ANTHROPIC_PROVIDER, "response body was not JSON");
      }

      // A safety decline is HTTP 200 with no usable content, so `stop_reason`
      // has to be checked before `content` is read — otherwise this surfaces as
      // a confusing "no text block" rather than as what it is.
      if (payload.stop_reason === "refusal") {
        throw new AiInvalidResponseError(
          ANTHROPIC_PROVIDER,
          `provider declined the request (${payload.stop_details?.category ?? "no category"})`
        );
      }

      // With thinking enabled the first block may be a thinking block, so the
      // first *text* block is the answer — not `content[0]`.
      const text = payload.content?.find((block) => block.type === "text")?.text;
      if (typeof text !== "string" || text.trim() === "") {
        throw new AiInvalidResponseError(ANTHROPIC_PROVIDER, "response contained no text block");
      }

      return text;
    },
  };
}
