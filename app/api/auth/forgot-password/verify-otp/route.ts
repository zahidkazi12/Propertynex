import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { forgotPasswordVerifySchema } from "@/lib/validation/auth";
import {
  getResetSession,
  checkOtp,
  promoteToVerified,
} from "@/lib/auth/password-reset-session";
import { normalizeOtpInput } from "@/lib/otp/code";
import { RESET_WINDOW_MS } from "@/lib/otp/config";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * Step 2 of password recovery: verify the passcode.
 *
 * On success the recovery token is exchanged for a fresh one and the session
 * moves to OTP_VERIFIED. The passcode is destroyed in the same write, which is
 * what makes it single-use — replaying it against this session finds no active
 * code, and it was salted with this session's token so it cannot be replayed
 * against another.
 *
 * The responses are deliberately coarse. "No such session", "expired session",
 * and "already verified" all collapse into one message, because a decoy session
 * (an identifier with no account) must be indistinguishable from a real one at
 * every step. The one thing the caller *is* told is how many attempts remain on
 * an incorrect code — that is information about their own typing, it is bounded
 * by the same budget for real and decoy sessions alike, and withholding it just
 * makes a genuine user hit the wall without warning.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit("otp-verify-ip", ip, 20, 10 * 60_000);
  if (!limit.allowed) {
    return jsonError("Too many attempts. Please wait a few minutes and try again.", 429);
  }

  try {
    const body = await request.json();
    const { recoveryToken, code } = forgotPasswordVerifySchema.parse(body);

    const session = await getResetSession(recoveryToken);
    if (!session) {
      return jsonError("This reset request is no longer valid. Please start again.", 400, {
        form: "EXPIRED_SESSION",
      });
    }

    const result = await checkOtp(session, normalizeOtpInput(code));

    switch (result.outcome) {
      case "OK":
        break;

      case "NO_ACTIVE_CODE":
        return jsonError("This reset request is no longer valid. Please start again.", 400, {
          form: "EXPIRED_SESSION",
        });

      case "EXPIRED":
        return jsonError(
          "That code has expired. Request a new one to continue.",
          400,
          { code: "EXPIRED_CODE" }
        );

      case "ATTEMPTS_EXHAUSTED":
        return jsonError(
          "Too many incorrect codes. Request a new code to continue.",
          429,
          { code: "ATTEMPTS_EXHAUSTED" }
        );

      case "INCORRECT":
        return jsonError(
          result.attemptsRemaining > 0
            ? `That code is not correct. ${result.attemptsRemaining} attempt${
                result.attemptsRemaining === 1 ? "" : "s"
              } left.`
            : "That code is not correct. Request a new code to continue.",
          401,
          { code: "INCORRECT_CODE" }
        );
    }

    const resetToken = await promoteToVerified(session.id);

    return jsonOk({
      resetToken,
      resetWindowSeconds: Math.round(RESET_WINDOW_MS / 1000),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Enter the 6-digit code.", 400, zodFieldErrors(error));
    }
    console.error("[forgot-password/verify-otp] unexpected error:", error);
    return jsonServerError();
  }
}
