import { getCurrentUser } from "@/lib/auth/session";
import { jsonOk, jsonServerError } from "@/lib/utils/api-response";
import type { SafeUser } from "@/types";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonOk({ user: null });
    }

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
    console.error("[session] unexpected error:", error);
    return jsonServerError();
  }
}
