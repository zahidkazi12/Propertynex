import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { forgotPasswordResetSchema } from "@/lib/validation/auth";
import { hashSecret } from "@/lib/auth/password";
import { getResetSession, consumeResetSession } from "@/lib/auth/password-reset-session";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * Step 3 of password recovery: set the new password.
 *
 * This is the critical server-side gate. The session must exist, be unused, be
 * unexpired, AND have already been promoted to OTP_VERIFIED by the verify step.
 * A client can never jump straight here with a self-issued flag — only a token
 * this server issued, and then upgraded itself after checking a passcode it
 * generated, is accepted.
 *
 * The `userId` check is not redundant with the stage check. A recovery session
 * opened for an identifier with no account carries `userId: null` (see the
 * start route), and while it can never realistically be verified — its passcode
 * is never delivered — this refuses to act on one rather than relying on that
 * being true. The response is the same generic message either way.
 *
 * Two things happen after the password changes, in this order: the recovery
 * session is consumed, so the token cannot reset the password a second time,
 * and every browsing session for the account is revoked, so anyone signed in
 * with the old password — including whoever may have prompted this reset — is
 * logged out everywhere.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit("otp-reset-ip", ip, 10, 10 * 60_000);
  if (!limit.allowed) {
    return jsonError("Too many requests. Please try again shortly.", 429);
  }

  try {
    const body = await request.json();
    const { resetToken, newPassword } = forgotPasswordResetSchema.parse(body);

    const session = await getResetSession(resetToken);
    if (!session || session.stage !== "OTP_VERIFIED" || !session.userId) {
      return jsonError("This reset request is no longer valid. Please start again.", 400, {
        form: "EXPIRED_SESSION",
      });
    }

    const passwordHash = await hashSecret(newPassword);

    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash },
    });

    await consumeResetSession(session.id);
    await revokeAllSessionsForUser(session.userId);

    return jsonOk({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    console.error("[forgot-password/reset] unexpected error:", error);
    return jsonServerError();
  }
}
