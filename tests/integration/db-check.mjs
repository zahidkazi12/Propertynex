/**
 * PROPERTYNEX — database reachability + schema/index check.
 *
 * A precondition probe, not a feature test. It answers three questions that the
 * property suites depend on and that are cheap to get wrong silently:
 *
 *   1. Is MongoDB reachable at DATABASE_URL at all?
 *   2. Does it accept a write (i.e. is it a replica set, as Prisma's MongoDB
 *      connector requires)?
 *   3. Do the indexes declared in prisma/schema.prisma actually exist on the
 *      `properties`, `property_inquiries` and `property_media` collections?
 *
 * Run:  node --env-file=.env tests/integration/db-check.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let failures = 0;
function report(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

try {
  const users = await prisma.user.count();
  report("mongodb reachable", true, `users=${users}`);
} catch (error) {
  report("mongodb reachable", false, String(error.message).split("\n")[0]);
  await prisma.$disconnect();
  process.exit(1);
}

// A write proves the deployment is a replica set — Prisma's MongoDB connector
// uses transactions internally and fails on a standalone mongod.
let probeId = null;
try {
  const probe = await prisma.property.create({
    data: {
      ownerId: "000000000000000000000000",
      title: "db-check probe",
      description:
        "Temporary row written by tests/integration/db-check.mjs to prove the deployment accepts writes. Deleted immediately.",
      propertyType: "APARTMENT",
      listingType: "RENT",
      price: 1,
      areaValue: 1,
      areaUnit: "SQFT",
      addressLine1: "probe",
      city: "probe",
      state: "probe",
      pincode: "000000",
      contactPreference: "IN_APP",
    },
  });
  probeId = probe.id;
  report("write accepted (replica set)", true);
} catch (error) {
  report("write accepted (replica set)", false, String(error.message).split("\n")[0]);
}

if (probeId) {
  await prisma.property.delete({ where: { id: probeId } }).catch(() => {});
  const stillThere = await prisma.property.findUnique({ where: { id: probeId } });
  report("probe row removed", stillThere === null);
}

// Index verification goes through the raw command interface: Prisma has no API
// for reading back index metadata, and asserting on `prisma db push` output
// would only prove the CLI ran, not that the indexes landed.
const EXPECTED = {
  properties: [
    ["ownerId", "status"],
    ["status", "listingType"],
    ["status", "propertyType"],
    ["status", "city"],
    ["status", "createdAt"],
    ["ownerId", "createdAt"],
  ],
  property_inquiries: [
    ["propertyId", "createdAt"],
    ["ownerId", "status"],
    ["fromUserId"],
  ],
  // The gallery read, the de-duplication lookup on upload, and owner-wide
  // accounting. The first is the one that matters for correctness rather than
  // speed: without it a listing's photos come back in whatever order Mongo
  // chooses, and "the order the seller arranged" stops being a property of the
  // query and becomes a property of luck.
  property_media: [
    ["propertyId", "kind", "sortOrder"],
    ["propertyId", "checksum"],
    ["ownerId"],
  ],
};

for (const [collection, expectedKeys] of Object.entries(EXPECTED)) {
  let indexes;
  try {
    const result = await prisma.$runCommandRaw({ listIndexes: collection });
    indexes = result.cursor.firstBatch.map((index) => Object.keys(index.key));
  } catch (error) {
    report(`indexes on ${collection}`, false, String(error.message).split("\n")[0]);
    continue;
  }

  const have = indexes.map((keys) => keys.join("+"));
  const missing = expectedKeys
    .map((keys) => keys.join("+"))
    .filter((wanted) => !have.includes(wanted));

  report(
    `indexes on ${collection}`,
    missing.length === 0,
    missing.length === 0 ? have.join(", ") : `missing ${missing.join(", ")}`
  );
}

await prisma.$disconnect();
console.log(failures === 0 ? "\nall database checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
