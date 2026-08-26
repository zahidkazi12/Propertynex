import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { forgotPasswordStartSchema } from "@/lib/validation/auth";
import { createResetSession } from "@/lib/auth/password-reset-session";
import { sendOtp, assertProviderConfigured } from "@/lib/otp/send";
import { OtpProviderNotConfiguredError } from "@/lib/otp/providers/types";
import {
  MAX_OTP_ATTEMPTS,
  MAX_RESENDS,
  OTP_LENGTH,
  OTP_TTL_MS,
  RESEND_COOLDOWN_SECONDS,
  START_RESPONSE_FLOOR_MS,
} from "@/lib/otp/config";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import {
  parseIdentifier,
  maskIdentifier,
  identifierRateKey,
  toE164,
  type ParsedIdentifier,
} from "@/lib/utils/identifier";
import { padTo } from "@/lib/utils/timing";
import { jsonOk, jsonServerError, zodFieldErrors, jsonError } from "@/lib/utils/api-response";

/**
 * Step 1 of password recovery: accept an email address or mobile number and
 * send a one-time passcode to it.
 *
 * ── Account-enumeration protection ──────────────────────────────────────────
 *
 * This endpoint answers identically whether or not the identifier belongs to an
 * account. Getting that right takes more than a shared error string, so all of
 * the following hold:
 *
 *  1. Same body, same status. Both paths return 200 with the same fields. The
 *     masked destination is a redaction of what the *caller typed*, not of
 *     anything read from the database, so echoing it back discloses nothing.
 *
 *  2. A real recovery session either way. An unknown identifier still gets a
 *     row in `password_reset_sessions` (with `userId: null`) and a real
 *     randomly generated passcode that is simply never delivered. Every
 *     follow-up call — verify, resend — therefore behaves the same as it would
 *     for a real account: the same cooldown, the same attempt budget, the same
 *     "that code is not right" response. Handing back an unpersisted decoy token
 *     instead would make step 2 answer "session expired" for unknown
 *     identifiers and "incorrect code" for real ones, which is exactly the
 *     oracle this is meant to close.
 *
 *  3. Same timing. The real path does a lookup and a provider round-trip that
 *     the decoy path does not, so every response is padded to a floor
 *     (START_RESPONSE_FLOOR_MS). Identical bodies with a 400ms tell are still
 *     an oracle.
 *
 *  4. Config faults are channel-wide, not account-specific. Provider
 *     configuration is checked before the account lookup, so a deployment
 *     missing its credentials fails the same way for every identifier.
 *
 *  5. Delivery faults do not change the answer. If the provider is configured
 *     but rejects this one message, the response is still the standard success
 *     body; the failure is logged server-side and the user can resend. Turning a
 *     bounce into a visible error would re-open the oracle for any address the
 *     provider refuses.
 *
 * A format error *is* reported plainly ("enter a valid email or mobile number")
 * — that describes the input, not the account, and refusing to say so would only
 * strand users who typo'd.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const body = await request.json();
    const { identifier: rawIdentifier } = forgotPasswordStartSchema.parse(body);

    const identifier = parseIdentifier(rawIdentifier);
    if (!identifier) {
      return jsonError("Enter a valid email address or mobile number.", 400, {
        identifier: "Enter a valid email address or mobile number",
      });
    }

    // Two limiters, deliberately. Per-IP stops one host from sweeping many
    // identifiers; per-identifier stops a distributed sweep from hammering one
    // account's recovery flow (and from burning that account's live session
    // over and over). The identifier key is a truncated digest, so the limiter
    // never holds raw contact details.
    const ipLimit = await checkRateLimit("otp-start-ip", ip, 8, 10 * 60_000);
    const idLimit = await checkRateLimit(
      "otp-start-id",
      identifierRateKey(identifier),
      4,
      10 * 60_000
    );
    if (!ipLimit.allowed || !idLimit.allowed) {
      await padTo(startedAt, START_RESPONSE_FLOOR_MS);
      return jsonError("Too many requests. Please wait a few minutes and try again.", 429);
    }

    const channel = identifier.kind === "EMAIL" ? "EMAIL" : "SMS";

    // Before the lookup — see note 4 above.
    try {
      assertProviderConfigured(channel);
    } catch (error) {
      if (error instanceof OtpProviderNotConfiguredError) {
        console.error("[forgot-password/start] provider not configured:", error.message);
        await padTo(startedAt, START_RESPONSE_FLOOR_MS);
        return jsonError(
          "Password reset is temporarily unavailable. Please try again later.",
          503
        );
      }
      throw error;
    }

    const user = await findUserByIdentifier(identifier);
    const destinationMasked = maskIdentifier(identifier);

    const { rawToken, code } = await createResetSession({
      userId: user?.id ?? null,
      channel,
      destinationMasked,
    });

    if (user) {
      // Send to the address on the account, not to the submitted string. For an
      // email identifier the two are equal; for a phone identifier the stored
      // value carries the formatting the user typed at signup, which an SMS
      // gateway will not accept — `toE164` renders it as "+<digits>".
      const destination = channel === "EMAIL" ? user.email : toE164(user.phone);
      try {
        await sendOtp({ channel, destination, code });
      } catch (error) {
        // Logged without the passcode — see note 5 above.
        console.error(
          "[forgot-password/start] delivery failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    await padTo(startedAt, START_RESPONSE_FLOOR_MS);
    return jsonOk({
      recoveryToken: rawToken,
      channel,
      destination: destinationMasked,
      codeLength: OTP_LENGTH,
      expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      resendsRemaining: MAX_RESENDS,
      maxAttempts: MAX_OTP_ATTEMPTS,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Enter a valid email address or mobile number.", 400, zodFieldErrors(error));
    }
    console.error("[forgot-password/start] unexpected error:", error);
    return jsonServerError();
  }
}

/**
 * Finds the account for an email or mobile identifier.
 *
 * Phone matching goes through `phoneDigits` so that "+91 98765 43210" and
 * "+919876543210" resolve to the same account. The exact-`phone` fallback
 * covers accounts created before `phoneDigits` existed, which have no value in
 * that field. Matching is exact on the full digit string rather than on a
 * suffix: a looser match could route a passcode to a different account that
 * merely shares a local number under another country code.
 */
async function findUserByIdentifier(identifier: ParsedIdentifier) {
  if (identifier.kind === "EMAIL") {
    return prisma.user.findUnique({ where: { email: identifier.value } });
  }
  return prisma.user.findFirst({
    where: {
      OR: [{ phoneDigits: identifier.value }, { phone: identifier.raw }],
    },
  });
}
