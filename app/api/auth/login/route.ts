import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { loginSchema } from "@/lib/validation/auth";
import { verifySecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import type { SafeUser } from "@/types";

const GENERIC_INVALID_CREDENTIALS = "Invalid email or password.";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit("login", ip, 10, 60_000);
  if (!limit.allowed) {
    return jsonError("Too many login attempts. Please try again shortly.", 429);
  }

  try {
    const body = await request.json();
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });

    // Same generic message whether the email doesn't exist or the password
    // is wrong — never reveal which one it was.
    if (!user) {
      return jsonError(GENERIC_INVALID_CREDENTIALS, 401);
    }

    const isValid = await verifySecret(data.password, user.passwordHash);
    if (!isValid) {
      return jsonError(GENERIC_INVALID_CREDENTIALS, 401);
    }

    await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: ip,
    });

    const safeUser: SafeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      image: user.image,
      createdAt: user.createdAt.toISOString(),
    };

    return jsonOk({ user: safeUser });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    console.error("[login] unexpected error:", error);
    return jsonServerError();
  }
}
