import { randomInt, createHmac, timingSafeEqual } from "crypto";
import { OTP_LENGTH } from "./config";

/**
 * Passcode generation and verification.
 *
 * The plaintext passcode exists in exactly two places: in memory for the
 * duration of the request that generates it, and in the message delivered to
 * the user. It is never persisted, never logged (outside the explicitly
 * development-only console provider), and never returned in an HTTP response.
 * What the database holds is the keyed HMAC produced by `hashOtp`.
 */

/**
 * The passcode HMAC key.
 *
 * `OTP_SECRET` is REQUIRED and has no fallback. It previously fell back to
 * `PASSWORD_RESET_SECRET`, which was convenient but wrong: it meant one leaked
 * value compromised two independent things at once — the recovery-session
 * tokens *and* every live passcode digest. Separate secrets keep the blast
 * radius of a leak to one of them, and a hard failure here is much easier to
 * diagnose than a deployment that silently shares keys.
 *
 * The value itself is never logged, never included in an error message, and
 * never returned to a caller — only the fact that it is missing or too short.
 */
function getOtpSecret(): string {
  const secret = process.env.OTP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "OTP_SECRET is missing or too short (min 16 characters). Set a dedicated strong random value in .env.local — see .env.example. It must NOT be the same value as PASSWORD_RESET_SECRET or AUTH_SECRET."
    );
  }
  return secret;
}

/**
 * A uniformly random numeric passcode.
 *
 * `randomInt` is used rather than `Math.random()` (not cryptographically
 * secure) and rather than `randomBytes(n) % 10` per digit (modulo bias).
 * Leading zeros are preserved by padding, so every value in the space is
 * equally likely — "004821" is as valid as "904821".
 */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

/**
 * Keyed HMAC of a passcode, bound to the recovery session it belongs to.
 *
 * Two properties matter here:
 *
 *  - It is *keyed*. A 6-digit code has only a million possible values, so a
 *    plain (even slow) hash of it is trivially reversible by anyone holding
 *    the digest. An attacker who reads the database cannot recover the code
 *    without also holding OTP_SECRET.
 *
 *  - It is bound to `sessionTokenHash`. The same passcode issued for two
 *    different recovery sessions produces two different digests, so a digest
 *    observed in one row can never be replayed against another.
 */
export function hashOtp(code: string, sessionTokenHash: string): string {
  return createHmac("sha256", getOtpSecret())
    .update(`${sessionTokenHash}:${code}`)
    .digest("hex");
}

/**
 * Constant-time comparison of a submitted passcode against a stored digest.
 *
 * Both digests are fixed-length hex, so `timingSafeEqual` is safe to call
 * directly; comparing with `===` would leak how many leading characters
 * matched, which over enough attempts narrows the code.
 */
export function verifyOtp(
  submitted: string,
  storedHash: string,
  sessionTokenHash: string
): boolean {
  const candidate = hashOtp(submitted, sessionTokenHash);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Strips formatting a user might paste in ("123 456", "123-456"). */
export function normalizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, "");
}
