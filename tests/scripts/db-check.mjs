/**
 * Is the listings store reachable, and what is in it?
 *
 * A connectivity probe, not a test: it prints counts so a developer can tell
 * "the Explore page is empty" (no published rows) apart from "the Explore page
 * is broken" (no database). Run with `node --env-file=.env tests/scripts/db-check.mjs`.
 *
 * Prints no connection string and no document contents — counts and enum keys
 * only, so it is safe to paste into an issue.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [users, properties, byStatus, media, inquiries] = await Promise.all([
    prisma.user.count(),
    prisma.property.count(),
    prisma.property.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.propertyMedia.count(),
    prisma.propertyInquiry.count(),
  ]);

  console.log("connected: yes");
  console.log(`users: ${users}`);
  console.log(`properties: ${properties}`);
  for (const row of byStatus) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }
  console.log(`media: ${media}`);
  console.log(`inquiries: ${inquiries}`);
} catch (error) {
  console.log("connected: no");
  console.log(`reason: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  console.log(String(error instanceof Error ? error.message : error).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
