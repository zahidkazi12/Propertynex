import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { signupSchema } from "@/lib/validation/auth";
import { hashSecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { normalizePhoneDigits } from "@/lib/utils/identifier";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import type { SafeUser } from "@/types";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit("signup", ip, 8, 60_000);
  if (!limit.allowed) {
    return jsonError("Too many signup attempts. Please try again shortly.", 429);
  }

  try {
    const body = await request.json();
    const data = signupSchema.parse(body);

    const [existingEmail, existingPhone] = await Promise.all([
      prisma.user.findUnique({ where: { email: data.email } }),
      prisma.user.findUnique({ where: { phone: data.phone } }),
    ]);

    if (existingEmail) {
      return jsonError("An account with this email already exists.", 409, {
        email: "This email is already registered",
      });
    }
    if (existingPhone) {
      return jsonError("An account with this phone number already exists.", 409, {
        phone: "This phone number is already registered",
      });
    }

    const passwordHash = await hashSecret(data.password);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        // Stored alongside the formatted number so password recovery can match
        // a mobile number the user re-types with different spacing.
        phoneDigits: normalizePhoneDigits(data.phone),
        passwordHash,
      },
    });

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
    // Mongo unique-index race condition fallback (two signups at once).
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return jsonError("An account with this email or phone already exists.", 409);
    }
    console.error("[signup] unexpected error:", error);
    return jsonServerError();
  }
}
