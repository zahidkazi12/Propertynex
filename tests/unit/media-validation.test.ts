import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_UPLOAD_FILES,
  mediaArrangeSchema,
  mediaKindSchema,
  mediaUpdateSchema,
  mediaUploadFieldsSchema,
} from "../../lib/validation/media";
import {
  MAX_ALT_LENGTH,
  MAX_FILES_PER_UPLOAD,
  UPLOADABLE_KINDS,
} from "../../lib/media/constants";

/**
 * `lib/validation/media.ts` — the trust boundary for every media write.
 *
 * ── What is being tested is mostly an absence ────────────────────────────────
 *
 * The schemas have no field for `storageKey`, `storageDriver`, `ownerId`,
 * `propertyId`, `mimeType`, `byteSize`, `width`, `height` or `checksum`. That is
 * not a stylistic choice — it is the mechanism that makes those columns
 * unwritable by a client, because Zod strips keys an object schema does not
 * declare. So the tests below post all of them and assert they are gone from the
 * parsed output. A future `.passthrough()` on any of these schemas would turn a
 * client-supplied `storageKey` into a path handed to `readFile`, and would fail
 * here first.
 *
 * The rest is the shape checking that keeps a hostile payload from reaching
 * Prisma's Mongo connector, which throws on a malformed ObjectId rather than
 * returning nothing — a 500 where a 404 belongs.
 */

const VALID_ID = "64b7c0f1a2d3e4f5a6b7c8d9";
const OTHER_ID = "0123456789abcdef01234567";

/** Fields a client might try to set that the server measures or derives itself. */
const FORBIDDEN_FIELDS = {
  id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  propertyId: OTHER_ID,
  ownerId: OTHER_ID,
  storageKey: "../../../../etc/passwd",
  storageDriver: "s3",
  mimeType: "image/svg+xml",
  byteSize: 1,
  width: 99_999,
  height: 99_999,
  checksum: "0".repeat(64),
  sortOrder: -1,
  createdAt: "1999-01-01T00:00:00.000Z",
};

function assertStripped(parsed: object) {
  for (const field of Object.keys(FORBIDDEN_FIELDS)) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed, field),
      false,
      `${field} survived validation: ${JSON.stringify(parsed)}`
    );
  }
  assert.equal(
    JSON.stringify(parsed).includes("etc/passwd"),
    false,
    "a client-supplied storage path survived validation"
  );
}

// ─────────────────────────────────────────────────────────────
// Upload fields
// ─────────────────────────────────────────────────────────────

test("kind defaults to IMAGE when the form omits it", () => {
  assert.equal(mediaKindSchema.parse(undefined), "IMAGE");
  assert.deepEqual(mediaUploadFieldsSchema.parse({}), { kind: "IMAGE" });
});

test("the only uploadable kind is the one that has a renderer", () => {
  assert.deepEqual(UPLOADABLE_KINDS, ["IMAGE"]);
  assert.equal(mediaKindSchema.parse("IMAGE"), "IMAGE");
});

test("the future media kinds are refused at the boundary, not half-handled", () => {
  // `MediaKind` has four members so a floor plan or a video is a new member with a
  // new renderer later, rather than a second table. Until then the boundary says no.
  for (const kind of ["VIDEO", "FLOOR_PLAN", "TOUR_360", "image", "IMAGE ", "", "IMAGE\0"]) {
    const result = mediaKindSchema.safeParse(kind);
    assert.equal(result.success, false, `accepted kind ${JSON.stringify(kind)}`);
  }
});

test("a refused kind says so in words a seller can read", () => {
  const result = mediaKindSchema.safeParse("VIDEO");
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0].message, /Only photos can be uploaded/);
  }
});

test("the upload form cannot set anything the server measures itself", () => {
  const parsed = mediaUploadFieldsSchema.parse({ kind: "IMAGE", ...FORBIDDEN_FIELDS });
  assert.deepEqual(parsed, { kind: "IMAGE" });
  assertStripped(parsed);
});

test("the per-request file cap is the shared constant, not a second number", () => {
  assert.equal(MAX_UPLOAD_FILES, MAX_FILES_PER_UPLOAD);
});

// ─────────────────────────────────────────────────────────────
// Arranging the gallery
// ─────────────────────────────────────────────────────────────

test("a reorder is an array of media ids", () => {
  assert.deepEqual(mediaArrangeSchema.parse({ order: [VALID_ID, OTHER_ID] }), {
    order: [VALID_ID, OTHER_ID],
  });
});

test("a cover change names one media id", () => {
  assert.deepEqual(mediaArrangeSchema.parse({ primaryId: VALID_ID }), { primaryId: VALID_ID });
});

test("a PATCH that asks for nothing is refused rather than answered 200", () => {
  // Answering an empty change with a success would hide the client bug that sent it.
  const result = mediaArrangeSchema.safeParse({});
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0].message, /Nothing to change/);
  }
});

test("an id that is not an ObjectId never reaches the database layer", () => {
  // Prisma's Mongo connector throws on a malformed ObjectId, so a shape check here
  // is what keeps a hostile path from becoming a 500 where a 404 belongs.
  const hostile = [
    "not-an-id",
    "64b7c0f1a2d3e4f5a6b7c8d", // 23
    "64b7c0f1a2d3e4f5a6b7c8d99", // 25
    "64b7c0f1a2d3e4f5a6b7c8dz",
    `${VALID_ID} `,
    ` ${VALID_ID}`,
    `${VALID_ID}\n`,
    "../../../etc/passwd",
    "$ne",
    "",
  ];

  for (const id of hostile) {
    assert.equal(
      mediaArrangeSchema.safeParse({ primaryId: id }).success,
      false,
      `accepted primaryId ${JSON.stringify(id)}`
    );
    assert.equal(
      mediaArrangeSchema.safeParse({ order: [VALID_ID, id] }).success,
      false,
      `accepted order containing ${JSON.stringify(id)}`
    );
  }
});

test("an id must be a string, so an operator object cannot be smuggled in", () => {
  // The NoSQL-injection shape: `{ primaryId: { $ne: null } }` as JSON.
  assert.equal(mediaArrangeSchema.safeParse({ primaryId: { $ne: null } }).success, false);
  assert.equal(mediaArrangeSchema.safeParse({ order: [{ $ne: null }] }).success, false);
  assert.equal(mediaArrangeSchema.safeParse({ order: VALID_ID }).success, false);
});

test("an absurdly long order list is refused before anything sorts it", () => {
  const many = Array.from({ length: 501 }, () => VALID_ID);
  assert.equal(mediaArrangeSchema.safeParse({ order: many }).success, false);
  assert.equal(mediaArrangeSchema.safeParse({ order: many.slice(0, 500) }).success, true);
});

test("an empty order list is a valid request, and means the gallery is unchanged", () => {
  // `lib/media/order.ts` treats it as "name nothing, move nothing" rather than
  // "delete everything", so the boundary has no reason to refuse it.
  assert.deepEqual(mediaArrangeSchema.parse({ order: [] }), { order: [] });
});

test("an arrange request cannot smuggle in a storage field", () => {
  const parsed = mediaArrangeSchema.parse({ primaryId: VALID_ID, ...FORBIDDEN_FIELDS });
  assert.deepEqual(parsed, { primaryId: VALID_ID });
  assertStripped(parsed);
});

// ─────────────────────────────────────────────────────────────
// Per-photo updates
// ─────────────────────────────────────────────────────────────

test("alt text is trimmed and its whitespace collapsed", () => {
  assert.deepEqual(mediaUpdateSchema.parse({ alt: "  Front   of   the  house  " }), {
    alt: "Front of the house",
  });
});

test("control characters in alt text become spaces, not markup and not nothing", () => {
  // The one field on a media row that is owner-authored free text and later
  // rendered. Newlines, tabs and NULs all collapse to a single space.
  const parsed = mediaUpdateSchema.parse({
    alt: "Kitchen with\ta\nnewworktop",
  });
  assert.deepEqual(parsed, { alt: "Kitchen with a new worktop" });
});

test("empty alt text becomes null rather than an empty string", () => {
  // "No description" and "a deliberately empty description" are the same thing for
  // a photograph, and a nullable column says so better than a sentinel.
  assert.deepEqual(mediaUpdateSchema.parse({ alt: "" }), { alt: null });
  assert.deepEqual(mediaUpdateSchema.parse({ alt: "   " }), { alt: null });
  assert.deepEqual(mediaUpdateSchema.parse({ alt: "\n\t " }), { alt: null });
});

test("alt text at the cap is accepted and one character past it is not", () => {
  const atCap = "x".repeat(MAX_ALT_LENGTH);
  assert.deepEqual(mediaUpdateSchema.parse({ alt: atCap }), { alt: atCap });

  const overCap = mediaUpdateSchema.safeParse({ alt: "x".repeat(MAX_ALT_LENGTH + 1) });
  assert.equal(overCap.success, false);
  if (!overCap.success) {
    assert.match(overCap.error.issues[0].message, /under 160 characters/);
  }
});

test("a megabyte of alt text is refused without being normalised first", () => {
  // The outer `max` exists so a hostile payload is not run through two regex
  // passes before being rejected on length anyway.
  assert.equal(mediaUpdateSchema.safeParse({ alt: "y".repeat(1_000_000) }).success, false);
});

test("alt text is measured after normalisation, so padding does not consume the cap", () => {
  // 160 real characters wrapped in whitespace is 160 characters, not 170.
  const padded = `     ${"z".repeat(MAX_ALT_LENGTH)}     `;
  assert.deepEqual(mediaUpdateSchema.parse({ alt: padded }), { alt: "z".repeat(MAX_ALT_LENGTH) });
});

test("isPrimary can only be set to true", () => {
  // "Not the cover" is not a state a listing can be in — some photo has to be it —
  // so the way to change the cover is to name the new one.
  assert.deepEqual(mediaUpdateSchema.parse({ isPrimary: true }), { isPrimary: true });
  assert.equal(mediaUpdateSchema.safeParse({ isPrimary: false }).success, false);
  assert.equal(mediaUpdateSchema.safeParse({ isPrimary: "true" }).success, false);
  assert.equal(mediaUpdateSchema.safeParse({ isPrimary: 1 }).success, false);
});

test("a per-photo PATCH that changes nothing is refused", () => {
  const result = mediaUpdateSchema.safeParse({});
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0].message, /Nothing to change/);
  }
});

test("a per-photo PATCH cannot set a position, an owner or a storage key", () => {
  // Position is settled by the collection endpoint, which normalises the whole
  // gallery; the rest is server-derived. None of them has a field here.
  const parsed = mediaUpdateSchema.parse({ alt: "Balcony", ...FORBIDDEN_FIELDS });
  assert.deepEqual(parsed, { alt: "Balcony" });
  assertStripped(parsed);
});

test("a __proto__ key in the payload is stripped like any other unknown key", () => {
  // `JSON.parse` — unlike an object literal — does produce a real own `__proto__`
  // property, so this is the shape a request body can actually arrive in.
  const parsed = mediaUpdateSchema.parse(
    JSON.parse('{"alt":"Garden","__proto__":{"isPrimary":true}}')
  );
  assert.deepEqual(parsed, { alt: "Garden" });
  assert.equal((parsed as { isPrimary?: unknown }).isPrimary, undefined);
  assert.equal(({} as { isPrimary?: unknown }).isPrimary, undefined);
});
