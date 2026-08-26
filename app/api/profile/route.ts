import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { updateProfileSchema } from "@/lib/validation/profile";
import { normalizePhoneDigits } from "@/lib/utils/identifier";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import type { SafeUser } from "@/types";

function toSafeUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  image: string | null;
  createdAt: Date;
}): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    image: user.image,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return jsonError("You must be logged in.", 401);
  }
  return jsonOk({ user: toSafeUser(user) });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return jsonError("You must be logged in.", 401);
  }

  try {
    const body = await request.json();
    const data = updateProfileSchema.parse(body);

    const existingPhoneOwner = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existingPhoneOwner && existingPhoneOwner.id !== user.id) {
      return jsonError("This phone number is already in use by another account.", 409, {
        phone: "This phone number is already registered",
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: data.name,
        phone: data.phone,
        // Kept in step with `phone` on every write — a stale value here would
        // silently break password recovery by mobile number for this account.
        phoneDigits: normalizePhoneDigits(data.phone),
        image: data.image || null,
      },
    });

    return jsonOk({ user: toSafeUser(updated) });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    console.error("[profile] unexpected error:", error);
    return jsonServerError();
  }
}
