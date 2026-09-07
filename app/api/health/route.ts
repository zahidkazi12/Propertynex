import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { describeAiProvider } from "@/lib/ai/provider";
import { getMediaStorageName } from "@/lib/media/storage";

/**
 * `/api/health` — which variables the running server can see, and whether the
 * things they configure actually work.
 *
 * Every value here is a boolean or a name, never a secret: the point is to tell a
 * missing variable apart from a broken connection, and the value of a credential
 * is not needed for that.
 */

export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      DATABASE_URL: !!process.env.DATABASE_URL,
      AUTH_SECRET: !!process.env.AUTH_SECRET,
      PASSWORD_RESET_SECRET: !!process.env.PASSWORD_RESET_SECRET,
      OTP_SECRET: !!process.env.OTP_SECRET,
    },
  };

  try {
    // Try a simple query
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    checks.database = { connected: true, result };
  } catch (error: unknown) {
    const e = error as Error;
    checks.database = {
      connected: false,
      error: e.message,
      name: e.name,
    };
  }

  // Resolving the driver is the check: it throws when the driver name is unknown,
  // when `local` is set on Vercel, or when the Blob driver has no credential — the
  // three ways a deployment can be configured such that the first upload fails.
  // Doing it here means that is a line in a diagnostic response rather than a
  // stack trace inside a seller's upload request.
  try {
    checks.mediaStorage = { driver: getMediaStorageName(), configured: true };
  } catch (error: unknown) {
    // The messages these throw are written for an operator and name only variables,
    // never values — see `lib/media/storage/index.ts` and `.../vercel-blob.ts`.
    checks.mediaStorage = { configured: false, error: (error as Error).message };
  }

  // AI search. `describeAiProvider` never throws and never returns a credential:
  // `{configured: false}` with no error means no provider is selected, which is a
  // supported deployment and not a fault. An `error` field means one *was*
  // selected and cannot be built — a sentence naming the missing variable, so an
  // operator finds out here instead of wondering why the assistant panel never
  // renders.
  checks.aiSearch = describeAiProvider();

  return NextResponse.json(checks);
}
