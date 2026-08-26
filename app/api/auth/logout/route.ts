import { destroyCurrentSession } from "@/lib/auth/session";
import { jsonOk, jsonServerError } from "@/lib/utils/api-response";

export async function POST() {
  try {
    await destroyCurrentSession();
    return jsonOk({ success: true });
  } catch (error) {
    console.error("[logout] unexpected error:", error);
    return jsonServerError();
  }
}
