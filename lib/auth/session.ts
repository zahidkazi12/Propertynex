import "server-only";
import { randomBytes, createHmac } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import type { User } from "@prisma/client";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";
export { SESSION_COOKIE_NAME }; // re-export so existing imports elsewhere still work
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set a strong random value in .env.local (see .env.example)."
    );
  }
  return secret;
}

/**
 * The raw session token is what lives in the browser cookie. We never store
 * that raw value server-side — only an HMAC of it — so that read access to
 * the database (a backup, a leaked export, a compromised admin query) can
 * never by itself be replayed as a valid session cookie.
 */
function hashToken(rawToken: string): string {
  return createHmac("sha256", getAuthSecret()).update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null }
): Promise<void> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      userAgent: meta?.userAgent ?? undefined,
      ipAddress: meta?.ipAddress ?? undefined,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Reads the session cookie (if any), verifies it against the database, and
 * returns the authenticated user — or null. Expired/invalid sessions are
 * treated as "not logged in" rather than throwing, so callers can use this
 * for simple gating.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Lazily clean up expired sessions rather than trusting the client.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await prisma.session.deleteMany({ where: { tokenHash } });
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

/** Used after a password reset to log the user out everywhere. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
