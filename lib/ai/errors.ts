/**
 * The four ways AI search can fail, as distinct types.
 *
 * ── Why four classes and not one ────────────────────────────────────────────
 *
 * The route branches on these to decide a status code and a sentence, in the
 * same way `app/api/auth/forgot-password/*` branches on
 * `OtpProviderNotConfiguredError`. Collapsing them would make every failure
 * read as "something went wrong", and the four are genuinely different actions
 * for whoever hits them:
 *
 *   - `AiNotConfiguredError` — an operator has not set `AI_PROVIDER`/`AI_API_KEY`,
 *     or set them wrongly. Nothing a visitor can do; the assistant should simply
 *     not be offered. This is the only one that is a *deployment* fault.
 *   - `AiUnavailableError` — a configured provider was reached and refused, or
 *     could not be reached. Transient. Retry is reasonable.
 *   - `AiTimeoutError` — the provider did not answer inside the deadline. A
 *     subclass of unavailable, because every caller that handles one handles the
 *     other, but distinguished so the message can say "took too long" rather
 *     than implying an outage.
 *   - `AiInvalidResponseError` — the provider answered and the answer was not
 *     usable criteria. Not transient in the same way: retrying the identical
 *     query will often produce the identical unusable answer, so the UI offers
 *     rephrasing rather than a retry button alone.
 *
 * ── What these never carry ─────────────────────────────────────────────────
 *
 * No API key, no request body, no provider URL with credentials in it. `detail`
 * is for the server log and is written for an operator; the routes never put it
 * in a response body — the same posture `lib/otp/providers/types.ts` takes, and
 * for the same reason: a client learns nothing useful from which variable is
 * missing, and an attacker learns which provider to impersonate.
 */

/** Base class, so a caller can catch every AI fault with one `instanceof`. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * No provider is configured, or its configuration is incomplete/unrecognised.
 *
 * Distinct from every other failure because it is answered differently: the
 * assistant is *withheld* rather than shown broken. See `isAiSearchAvailable`.
 */
export class AiNotConfiguredError extends AiError {
  constructor(detail: string) {
    super(`AI provider is not configured: ${detail}`);
    this.name = "AiNotConfiguredError";
  }
}

/** A configured provider was unreachable, or refused the request. */
export class AiUnavailableError extends AiError {
  constructor(
    readonly providerName: string,
    detail: string
  ) {
    super(`AI provider ${providerName} is unavailable: ${detail}`);
    this.name = "AiUnavailableError";
  }
}

/** The provider did not answer inside the deadline. */
export class AiTimeoutError extends AiUnavailableError {
  constructor(providerName: string, timeoutMs: number) {
    super(providerName, `no response within ${timeoutMs}ms`);
    this.name = "AiTimeoutError";
  }
}

/**
 * The provider answered, and the answer was not usable search criteria — not
 * JSON, JSON of the wrong shape, or values outside the allowed sets.
 *
 * Reaching this is the system working as intended: it is the boundary that
 * stops a model's output from becoming a database filter. See
 * `lib/ai/criteria.ts`.
 */
export class AiInvalidResponseError extends AiError {
  constructor(
    readonly providerName: string,
    detail: string
  ) {
    super(`AI provider ${providerName} returned an unusable response: ${detail}`);
    this.name = "AiInvalidResponseError";
  }
}

/**
 * The machine-readable code the API route puts in its body, and the client
 * switches on to pick a message.
 *
 * A closed union rather than the class name, so renaming a class is not a
 * breaking change to the wire format, and so nothing about the server's internal
 * structure is published.
 */
export type AiFailureCode =
  | "ai_not_configured"
  | "ai_unavailable"
  | "ai_timeout"
  | "ai_invalid_response";

export function aiFailureCode(error: unknown): AiFailureCode | null {
  if (error instanceof AiNotConfiguredError) return "ai_not_configured";
  if (error instanceof AiTimeoutError) return "ai_timeout";
  if (error instanceof AiUnavailableError) return "ai_unavailable";
  if (error instanceof AiInvalidResponseError) return "ai_invalid_response";
  return null;
}
