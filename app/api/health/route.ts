import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

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

  return NextResponse.json(checks);
}
