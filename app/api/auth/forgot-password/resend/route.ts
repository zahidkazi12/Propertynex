import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { forgotPasswordResendSchema } from "@/lib/validation/auth";
import {
  getResetSession,
  canResend,
  rotateOtp,
  MAX_RESENDS,
} from "@/lib/auth/password-reset-session";
import { sendOtp } from "@/lib/otp/send";
import { OtpProviderNotConfiguredError } from "@/lib/otp/providers/types";
import {
  OTP_TTL_MS,
  RESEND_COOLDOWN_SECONDS,
  START_RESPONSE_FLOOR_MS,
} from "@/lib/otp/config";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { toE164 } from "@/lib/utils/identifier";
import { padTo } from "@/lib/utils/timing";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * Re-sends a passcode for an existing recovery session.
 *
 * Three independent limits apply, and they exist for different reasons:
 *
 *  - The 60-second cooldown (`canResend`) keeps a user from spamming their own
 *    inbox, and stops the endpoint being used as a cheap way to send mail
 *    through this deployment.
 *  - The per-session resend cap bounds the total guess budget: each new code
 *    resets the per-code attempt counter, so without a cap on resends the
 *    attempt limit would be meaningless.
 *  - The per-IP limiter catches someone cycling through sessions rather than
 *    hammering one.
 *
 * As in step 1, a session with no account behind it is treated exactly like a
 * real one — counters advance, cooldown applies, the response is identical —
 * except that nothing is actually dispatched. And as in step 1, a delivery
 * failure does not change the response; it is logged and the user may try
 * again once the cooldown clears.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const limit = await checkRateLimit("otp-resend-ip", ip, 10, 10 * 60_000);
  if (!limit.allowed) {
    return jsonError("Too many requests. Please wait a few minutes and try again.", 429);
  }

  try {
    const body = await request.json();
    const { recoveryToken } = forgotPasswordResendSchema.parse(body);

    const session = await getResetSession(recoveryToken);
    if (!session) {
      return jsonError("This reset request is no longer valid. Please start again.", 400, {
        form: "EXPIRED_SESSION",
      });
    }

    const decision = canResend(session);
    if (!decision.allowed) {
      switch (decision.reason) {
        case "COOLDOWN":
          return jsonError(
            `Please wait ${Math.ceil(decision.retryAfterMs / 1000)}s before requesting another code.`,
            429,
            { form: "COOLDOWN" }
          );
        case "LIMIT_REACHED":
          return jsonError(
            "You've requested the maximum number of codes. Please start again.",
            429,
            { form: "RESEND_LIMIT" }
          );
        case "NOT_PENDING":
          return jsonError("This reset request is no longer valid. Please start again.", 400, {
            form: "EXPIRED_SESSION",
          });
      }
    }

    const { code } = await rotateOtp(session);

    if (session.user) {
      // Phone numbers are stored as the user typed them; an SMS gateway needs
      // E.164. Same normalisation as the start route.
      const destination =
        session.channel === "EMAIL" ? session.user.email : toE164(session.user.phone);
      try {
        await sendOtp({
          channel: session.channel === "EMAIL" ? "EMAIL" : "SMS",
          destination,
          code,
        });
      } catch (error) {
        if (error instanceof OtpProviderNotConfiguredError) {
          console.error("[forgot-password/resend] provider not configured:", error.message);
          await padTo(startedAt, START_RESPONSE_FLOOR_MS);
          return jsonError(
            "Password reset is temporarily unavailable. Please try again later.",
            503
          );
        }
        console.error(
          "[forgot-password/resend] delivery failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    await padTo(startedAt, START_RESPONSE_FLOOR_MS);
    return jsonOk({
      channel: session.channel,
      destination: session.destinationMasked,
      expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      resendsRemaining: Math.max(0, MAX_RESENDS - (session.resendCount + 1)),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("This reset request is no longer valid. Please start again.", 400, zodFieldErrors(error));
    }
    console.error("[forgot-password/resend] unexpected error:", error);
    return jsonServerError();
  }
}
