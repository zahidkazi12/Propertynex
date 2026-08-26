/**
 * Parsing, normalizing, and masking the single "email or mobile number" field
 * that starts password recovery.
 *
 * Masking always operates on what the *caller submitted*, never on what the
 * database holds. That distinction is what lets the response say "we sent a
 * code to j••••n@example.com" without disclosing whether such an account
 * exists — the caller is only being shown a redaction of their own input.
 */
import { createHash } from "crypto";

export type IdentifierKind = "EMAIL" | "PHONE";

export interface ParsedIdentifier {
  kind: IdentifierKind;
  /** Canonical form used for lookup: lowercased email, or digits-only phone. */
  value: string;
  /** Exactly what the user typed, trimmed. Used for legacy phone matching. */
  raw: string;
}

// Intentionally permissive but anchored: one "@", no whitespace, a dot in the
// domain. Strict RFC 5322 validation rejects addresses that real mail servers
// accept, and the authoritative check here is "does it match a row" anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Deliberately more permissive than the signup phone rule
// (lib/validation/auth.ts), which requires the value to start with a digit or
// "+". Someone recovering an account is re-typing a number from memory and may
// well bracket the country code — "(91) 98765-43210" — even though signup would
// have rejected that spelling. Being lenient here costs nothing: the value is
// only ever reduced to digits for the lookup and masked for display, never
// stored, so the authoritative check remains "do these digits match a row".
// The real validation is the digit count below, not the shape.
const PHONE_RE = /^\+?[0-9\s\-()]{8,20}$/;

// E.164 caps a subscriber number at 15 digits; 8 is a floor below which the
// value is more likely a typo than a phone number.
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

/** Digits only: "+91 98765-43210" -> "919876543210". */
export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Renders a stored phone number in E.164 ("+919876543210") for an SMS gateway.
 *
 * `User.phone` preserves exactly what the user typed at signup — "+91 98765
 * 43210", "(91) 98765-43210" — because that is the human-facing value and it
 * owns the uniqueness constraint. SMS APIs do not accept it in that form:
 * Twilio documents `To` as E.164 and rejects numbers carrying spaces or
 * punctuation (error 21211). Sending the stored string straight through is the
 * kind of thing that works in a console-provider test and fails on the first
 * real message.
 *
 * `User.phoneDigits` is deliberately NOT used here: it is optional, and accounts
 * created before that field existed have no value in it. Deriving from `phone`
 * works for every row.
 *
 * Limitation worth knowing: this cannot invent a country code. A number stored
 * without one ("9876543210") becomes "+9876543210", which is not a valid E.164
 * number and the gateway will reject it. Signup does not require a country code,
 * so that is a pre-existing data-quality gap — fixing it properly means either
 * enforcing "+<country code>" at signup or configuring a default region, both of
 * which change signup validation and are out of scope here.
 */
export function toE164(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  return digits ? `+${digits}` : "";
}

/**
 * Classifies the submitted identifier, or returns null if it is neither a
 * plausible email nor a plausible phone number.
 *
 * The "@" test comes first so that a malformed email is reported as a bad
 * email rather than being misread as a phone number.
 */
export function parseIdentifier(input: string): ParsedIdentifier | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.includes("@")) {
    if (!EMAIL_RE.test(raw)) return null;
    return { kind: "EMAIL", value: raw.toLowerCase(), raw };
  }

  if (PHONE_RE.test(raw)) {
    const digits = normalizePhoneDigits(raw);
    // Guards against a value that passes the shape test but is mostly
    // punctuation, e.g. "1((((((((" or a row of dashes.
    if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
    return { kind: "PHONE", value: digits, raw };
  }

  return null;
}

/** "jonathan@example.com" -> "j••••••••n@example.com" */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}•${domain}`;
  return `${local[0]}${"•".repeat(Math.min(local.length - 2, 8))}${local[local.length - 1]}${domain}`;
}

/** "+91 98765 43210" -> "•••••••3210" */
function maskPhone(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskIdentifier(identifier: ParsedIdentifier): string {
  return identifier.kind === "EMAIL"
    ? maskEmail(identifier.value)
    : maskPhone(identifier.raw);
}

/**
 * A short, stable, non-reversible key for rate-limit buckets.
 *
 * Rate limiting has to be per-identifier as well as per-IP (otherwise one
 * account can be targeted from many addresses), but the limiter is a plain
 * in-memory Map and there is no reason for it to hold raw email addresses or
 * phone numbers. A truncated digest is enough to bucket by.
 */
export function identifierRateKey(identifier: ParsedIdentifier): string {
  return createHash("sha256")
    .update(`${identifier.kind}:${identifier.value}`)
    .digest("hex")
    .slice(0, 32);
}