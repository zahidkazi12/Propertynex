import "server-only";
import { randomBytes, createHmac } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { generateOtp, hashOtp, verifyOtp } from "@/lib/otp/code";
import {
  MAX_OTP_ATTEMPTS,
  MAX_RESENDS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  RESET_WINDOW_MS,
} from "@/lib/otp/config";
import type { OtpChannel } from "@/lib/otp/providers/types";

/**
 * The password-recovery session: the only thing the client holds between steps.
 *
 * This replaces the security-question recovery session, and keeps its two
 * defining properties unchanged:
 *
 *  - The client holds an opaque random token, never a user id and never a
 *    "verified" flag it could forge. Only a token this server issued, and then
 *    itself promoted to OTP_VERIFIED, is accepted for a password reset.
 *
 *  - The token's HMAC is what gets stored, not the token, so database read
 *    access alone cannot produce a usable recovery token.
 *
 * What is new is that the session also carries the passcode state (hash,
 * expiry, attempt and resend counters), and that `userId` may be null for a
 * decoy session — see the schema comment on PasswordResetSession.
 */

const SESSION_TTL_MS = OTP_TTL_MS + RESEND_COOLDOWN_MS * MAX_RESENDS;

function getResetSecret(): string {
  const secret = process.env.PASSWORD_RESET_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "PASSWORD_RESET_SECRET is missing or too short. Set a strong random value in .env.local."
    );
  }
  return secret;
}

function hashToken(rawToken: string): string {
  return createHmac("sha256", getResetSecret()).update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export type ResetSessionStage = "OTP_PENDING" | "OTP_VERIFIED";

/**
 * Opens a recovery session and mints its first passcode.
 *
 * Returns the plaintext passcode to the caller, which is the only point at
 * which it exists outside the delivery provider. A decoy session (userId null)
 * gets a real, randomly generated passcode too — the caller simply never
 * delivers it, so it is unguessable within the attempt budget, and the reset
 * step rejects a session with no user regardless.
 */
export async function createResetSession(params: {
  userId: string | null;
  channel: OtpChannel;
  destinationMasked: string;
}): Promise<{ rawToken: string; code: string }> {
  // One live recovery session per real account: a second "forgot password"
  // request supersedes the first rather than giving an attacker two independent
  // attempt budgets to work through in parallel. Decoy sessions have no user to
  // key on and are left to expire.
  if (params.userId) {
    await prisma.passwordResetSession.deleteMany({
      where: { userId: params.userId, used: false },
    });
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const code = generateOtp();
  const now = new Date();

  await prisma.passwordResetSession.create({
    data: {
      tokenHash,
      userId: params.userId,
      channel: params.channel,
      destinationMasked: params.destinationMasked,
      otpHash: hashOtp(code, tokenHash),
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      lastSentAt: now,
      stage: "OTP_PENDING",
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });

  return { rawToken, code };
}

/**
 * Looks up a live session by its raw token.
 *
 * Returns null for anything unusable — unknown token, already consumed, or
 * past its overall expiry — so that every one of those cases collapses into a
 * single generic response at the route layer.
 */
export async function getResetSession(rawToken: string) {
  const session = await prisma.passwordResetSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.used) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  return session;
}

export type LiveResetSession = NonNullable<Awaited<ReturnType<typeof getResetSession>>>;

export type OtpCheckResult =
  | { outcome: "OK" }
  | { outcome: "NO_ACTIVE_CODE" }
  | { outcome: "EXPIRED" }
  | { outcome: "ATTEMPTS_EXHAUSTED" }
  | { outcome: "INCORRECT"; attemptsRemaining: number };

/**
 * Checks a submitted passcode against a session and records the outcome.
 *
 * Ordering matters here. The attempt budget is checked *before* the comparison,
 * so an exhausted session cannot be probed further even with the right code;
 * and expiry is checked before the comparison so an expired code is never
 * accepted regardless of correctness.
 *
 * A correct passcode does not by itself grant anything — the caller must still
 * call `promoteToVerified`, which is what rotates the token and moves the
 * stage. Verification and promotion are kept apart so the "one-time use"
 * guarantee lives in one place.
 */
export async function checkOtp(
  session: LiveResetSession,
  submittedCode: string
): Promise<OtpCheckResult> {
  if (session.stage !== "OTP_PENDING" || !session.otpHash || !session.otpExpiresAt) {
    return { outcome: "NO_ACTIVE_CODE" };
  }

  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
    return { outcome: "ATTEMPTS_EXHAUSTED" };
  }

  if (session.otpExpiresAt.getTime() < Date.now()) {
    return { outcome: "EXPIRED" };
  }

  if (!verifyOtp(submittedCode, session.otpHash, session.tokenHash)) {
    const updated = await prisma.passwordResetSession.update({
      where: { id: session.id },
      data: { otpAttempts: { increment: 1 } },
      select: { otpAttempts: true },
    });
    return {
      outcome: "INCORRECT",
      attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - updated.otpAttempts),
    };
  }

  return { outcome: "OK" };
}

/**
 * Promotes a session to OTP_VERIFIED and issues a fresh token for the reset step.
 *
 * Three things happen together, and all three matter:
 *
 *  - `otpHash` and `otpExpiresAt` are cleared. The passcode is spent; it cannot
 *    be presented a second time, and a verified session holds no passcode
 *    material at all. This is what makes a passcode one-time-use.
 *
 *  - The session token is rotated. The token the client used to verify is
 *    invalidated and a new one is returned, so a pre-verification token that
 *    leaked (a shared link, a proxy log) cannot be used to reset a password.
 *
 *  - `expiresAt` is pulled in to a short reset window. Up to this point the
 *    token only allowed guessing a passcode; from here it is proof of identity,
 *    so it should live for minutes, not the original recovery window.
 */
export async function promoteToVerified(sessionId: string): Promise<string> {
  const rawToken = generateRawToken();
  await prisma.passwordResetSession.update({
    where: { id: sessionId },
    data: {
      tokenHash: hashToken(rawToken),
      stage: "OTP_VERIFIED",
      otpHash: null,
      otpExpiresAt: null,
      expiresAt: new Date(Date.now() + RESET_WINDOW_MS),
    },
  });
  return rawToken;
}

export type ResendDecision =
  | { allowed: true }
  | { allowed: false; reason: "COOLDOWN"; retryAfterMs: number }
  | { allowed: false; reason: "LIMIT_REACHED" }
  | { allowed: false; reason: "NOT_PENDING" };

/** Whether this session may be sent another passcode right now. */
export function canResend(session: LiveResetSession): ResendDecision {
  if (session.stage !== "OTP_PENDING") {
    return { allowed: false, reason: "NOT_PENDING" };
  }
  if (session.resendCount >= MAX_RESENDS) {
    return { allowed: false, reason: "LIMIT_REACHED" };
  }
  const sinceLastSend = Date.now() - session.lastSentAt.getTime();
  if (sinceLastSend < RESEND_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "COOLDOWN",
      retryAfterMs: RESEND_COOLDOWN_MS - sinceLastSend,
    };
  }
  return { allowed: true };
}

/**
 * Replaces the session's passcode with a new one and returns it.
 *
 * The per-code attempt counter resets — otherwise a user who mistyped five
 * times could never recover even with a fresh code — but `resendCount`
 * increments and is capped, so the total guess budget for the session stays
 * bounded at (MAX_RESENDS + 1) * MAX_OTP_ATTEMPTS. Issuing a new code also
 * invalidates the previous one, since only one hash is stored.
 */
export async function rotateOtp(session: LiveResetSession): Promise<{ code: string }> {
  const code = generateOtp();
  const now = new Date();
  await prisma.passwordResetSession.update({
    where: { id: session.id },
    data: {
      otpHash: hashOtp(code, session.tokenHash),
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      otpAttempts: 0,
      resendCount: { increment: 1 },
      lastSentAt: now,
    },
  });
  return { code };
}

/** Marks the session spent. Called once the password has actually changed. */
export async function consumeResetSession(sessionId: string): Promise<void> {
  await prisma.passwordResetSession.update({
    where: { id: sessionId },
    data: { used: true, otpHash: null, otpExpiresAt: null },
  });
}

/** Best-effort cleanup of expired sessions; safe to call and ignore. */
export async function pruneExpiredResetSessions(): Promise<void> {
  await prisma.passwordResetSession
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

export { MAX_OTP_ATTEMPTS, MAX_RESENDS };
