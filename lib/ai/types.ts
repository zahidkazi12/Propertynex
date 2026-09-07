/**
 * The AI provider seam.
 *
 * ── What a provider is, and what it is deliberately not ─────────────────────
 *
 * A provider takes a system prompt, a short conversation, and a JSON schema,
 * and returns **text that should be JSON**. That is the whole contract. It does
 * not:
 *
 *   - see a property row, an account, a session, or anything from the database;
 *   - decide what matches; that is `lib/ai/match.ts`, which is deterministic;
 *   - decide what is searched; that is `lib/ai/merge.ts` and the existing
 *     `buildBrowseWhere`, which only accept the closed `BrowseQuery` vocabulary;
 *   - parse its own output; the caller validates it against a Zod schema and
 *     throws `AiInvalidResponseError` if it does not fit.
 *
 * Returning a raw string rather than a parsed object is the point. If a provider
 * could hand back an object, the temptation would be for each implementation to
 * do its own coercion, and "the AI said parking is true" would mean something
 * slightly different per provider. One parser, one validator, one place where
 * model output becomes application data.
 *
 * ── Why this mirrors `lib/otp/providers/types.ts` ──────────────────────────
 *
 * Because it is the same problem: a replaceable third party behind a two-method
 * interface, configured only by environment variables, whose failures have to be
 * distinguishable by *type* so the routes can answer differently. Keeping the
 * shape identical means a reader who has understood one has understood both.
 *
 * Client-safe by construction: this file holds types and no `process.env` read,
 * so importing it cannot pull a credential into a browser bundle. The modules
 * that *do* read the environment (`./provider`, `./providers/*`) are
 * `server-only`.
 */

/**
 * One turn of the search conversation as it reaches a provider.
 *
 * Only ever the visitor's own typed text and the assistant's own previous
 * structured criteria — never a name, an email address, a session, a listing, or
 * a seller. See `lib/ai/property-search.ts` for what is assembled and the note
 * there on why nothing else may be added.
 */
export type AiMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
};

export type AiCompletionRequest = {
  /** Instructions and the output contract. Built by `lib/ai/prompts.ts`. */
  readonly system: string;
  readonly messages: readonly AiMessage[];
  /**
   * JSON Schema the reply must satisfy.
   *
   * Providers that support structured output enforce it at the model; the ones
   * that do not simply state it in the prompt. Either way the caller re-validates
   * with Zod, so this is an optimisation that reduces retries, never the thing
   * that makes the output safe.
   */
  readonly jsonSchema: Record<string, unknown>;
  /** Hard ceiling on the reply. Criteria JSON is small; this is a bound, not a
   *  target. */
  readonly maxOutputTokens: number;
  /** Wall-clock deadline. A hung provider must not hold a request open. */
  readonly timeoutMs: number;
};

export interface AiProvider {
  /** Short identifier for server-side logs. Never user-facing, never a URL. */
  readonly name: string;
  /**
   * The model this provider will call, for diagnostics (`/api/health`).
   * A model name is not a credential and is safe to report to an operator.
   */
  readonly model: string;
  /**
   * Ask for one completion, or throw.
   *
   * Throws `AiTimeoutError` on the deadline and `AiUnavailableError` for a
   * network fault or a non-2xx response. It may also throw
   * `AiInvalidResponseError` for the narrow case of a 2xx that carried no text
   * at all — a malformed envelope, or a provider that declined — because there
   * is then nothing to hand back and the caller cannot tell the difference from
   * an empty string. Whether text that *does* arrive is usable criteria is not
   * this interface's question; that is the caller's, and it answers it with Zod.
   */
  complete(request: AiCompletionRequest): Promise<string>;
}
