import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";
import type { PropertyMedia } from "@prisma/client";

import {
  toPublicGallery,
  toPublicMedia,
  toSafeGallery,
  toSafeMedia,
} from "../../lib/media/serialize";

/**
 * `lib/media/serialize.ts` — the two projections that cross a boundary.
 *
 * ── Why the key sets are asserted exhaustively ──────────────────────────────
 *
 * `storageDriver`, `storageKey` and `checksum` sit on the row right next to the
 * fields that *are* published. The projections are written out field by field
 * precisely so that widening the row cannot widen a JSON response, and the tests
 * below check the whole key set rather than spot-checking a few fields — an
 * assertion that only looked for the absence of `storageKey` would keep passing
 * if someone reintroduced a spread and a differently-named path field appeared.
 *
 * ── Order is the public contract ────────────────────────────────────────────
 *
 * `PublicMedia` carries no `isPrimary` flag, so index 0 of the public gallery *is*
 * the cover. That makes `toPublicGallery` the place where "the order the seller
 * chose is preserved" either becomes true or does not, and `PropertyGallery`
 * renders the array as-is on the strength of it.
 */

const BASE: PropertyMedia = {
  id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  propertyId: "64b7c0f1a2d3e4f5a6b7c8d9",
  ownerId: "0123456789abcdef01234567",
  kind: "IMAGE",
  storageDriver: "local",
  storageKey: "properties/64b7c0f1a2d3e4f5a6b7c8d9/0123456789abcdef0123456789abcdef.jpg",
  mimeType: "image/jpeg",
  byteSize: 204_800,
  width: 1600,
  height: 1200,
  checksum: "f".repeat(64),
  alt: "The front of the house",
  sortOrder: 0,
  isPrimary: true,
  createdAt: new Date("2026-03-01T10:00:00.000Z"),
  updatedAt: new Date("2026-03-02T11:00:00.000Z"),
};

function row(overrides: Partial<PropertyMedia> = {}): PropertyMedia {
  return { ...BASE, ...overrides };
}

/** The fields whose disclosure would publish the storage layout. */
const SECRET_VALUES = [BASE.storageKey, BASE.storageDriver, BASE.checksum, BASE.ownerId];

function assertNothingLeaked(projected: object) {
  const serialised = JSON.stringify(projected);
  for (const secret of SECRET_VALUES) {
    assert.equal(
      serialised.includes(secret),
      false,
      `projection leaked ${JSON.stringify(secret)}: ${serialised}`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// The owner's projection
// ─────────────────────────────────────────────────────────────

test("toSafeMedia publishes exactly the owner-facing fields", () => {
  const safe = toSafeMedia(row());

  assert.deepEqual(Object.keys(safe).sort(), [
    "alt",
    "byteSize",
    "createdAt",
    "height",
    "id",
    "isPrimary",
    "kind",
    "mimeType",
    "propertyId",
    "sortOrder",
    "url",
    "width",
  ]);
  assertNothingLeaked(safe);
});

test("toSafeMedia carries the fields the photo manager actually shows", () => {
  const safe = toSafeMedia(row({ alt: null }));
  assert.equal(safe.id, BASE.id);
  assert.equal(safe.mimeType, "image/jpeg");
  assert.equal(safe.byteSize, 204_800);
  assert.equal(safe.width, 1600);
  assert.equal(safe.height, 1200);
  assert.equal(safe.alt, null);
  assert.equal(safe.isPrimary, true);
  assert.equal(safe.sortOrder, 0);
});

test("dates leave as ISO strings, not Date objects", () => {
  // The projection crosses into a Client Component, where a `Date` would either
  // be serialised implicitly or throw. Doing it here makes the shape honest.
  const safe = toSafeMedia(row());
  assert.equal(safe.createdAt, "2026-03-01T10:00:00.000Z");
  assert.equal(typeof safe.createdAt, "string");
});

// ─────────────────────────────────────────────────────────────
// The visitor's projection
// ─────────────────────────────────────────────────────────────

test("toPublicMedia publishes only what is needed to render the picture", () => {
  const publicMedia = toPublicMedia(row());

  assert.deepEqual(Object.keys(publicMedia).sort(), ["alt", "height", "id", "url", "width"]);
  assertNothingLeaked(publicMedia);
});

test("a media URL is built from the row id, never from its storage key", () => {
  // `mediaUrl()` is the only place in the app a media address is constructed, and
  // it takes an id. There is no call site that could hand it a key.
  for (const projection of [toSafeMedia(row()), toPublicMedia(row())]) {
    assert.equal(projection.url, `/api/media/${BASE.id}`);
    assert.doesNotMatch(projection.url, /properties\/|\.jpg$|local/);
  }
});

// ─────────────────────────────────────────────────────────────
// Galleries
// ─────────────────────────────────────────────────────────────

const THREE = [
  row({ id: "ccc", sortOrder: 2, isPrimary: false }),
  row({ id: "aaa", sortOrder: 0, isPrimary: false }),
  row({ id: "bbb", sortOrder: 1, isPrimary: true }),
];

test("toSafeGallery is in position order, whatever order the rows arrived in", () => {
  assert.deepEqual(
    toSafeGallery(THREE).map((media) => media.id),
    ["aaa", "bbb", "ccc"]
  );
});

test("toSafeGallery keeps the cover flag, because the manager needs to show it", () => {
  const gallery = toSafeGallery(THREE);
  assert.deepEqual(
    gallery.map((media) => media.isPrimary),
    [false, true, false]
  );
});

test("toPublicGallery leads with the cover and then keeps the seller's order", () => {
  // The whole public contract in one assertion: `bbb` is the cover, so it moves to
  // the front; `aaa` and `ccc` stay in the order the seller arranged them.
  assert.deepEqual(
    toPublicGallery(THREE).map((media) => media.id),
    ["bbb", "aaa", "ccc"]
  );
});

test("toPublicGallery does not re-sort beyond promoting the cover", () => {
  // A gallery whose cover is already first must come out untouched. A projection
  // that sorted by anything else would silently override every drag the seller made.
  const arranged = [
    row({ id: "one", sortOrder: 0, isPrimary: true }),
    row({ id: "two", sortOrder: 1, isPrimary: false }),
    row({ id: "three", sortOrder: 2, isPrimary: false }),
    row({ id: "four", sortOrder: 3, isPrimary: false }),
  ];
  assert.deepEqual(
    toPublicGallery(arranged).map((media) => media.id),
    ["one", "two", "three", "four"]
  );
});

test("toPublicGallery tolerates a gallery with no cover flagged", () => {
  const flagless = THREE.map((media) => ({ ...media, isPrimary: false }));
  assert.deepEqual(
    toPublicGallery(flagless).map((media) => media.id),
    ["aaa", "bbb", "ccc"]
  );
});

test("toPublicGallery tolerates a gallery with several covers flagged", () => {
  // What a lost race between two concurrent cover changes leaves behind. The
  // listing still renders; the seller may see a cover they did not pick.
  const doubled = THREE.map((media) => ({ ...media, isPrimary: true }));
  assert.deepEqual(
    toPublicGallery(doubled).map((media) => media.id),
    ["aaa", "bbb", "ccc"]
  );
});

test("toPublicGallery drops kinds that are not photographs", () => {
  // `PublicMedia` has no `kind` field, so an unfiltered projection would put a
  // floor plan or a video poster in the photo carousel with nothing to mark it.
  const mixed = [
    row({ id: "plan", kind: "FLOOR_PLAN", sortOrder: 0, isPrimary: true }),
    row({ id: "video", kind: "VIDEO", sortOrder: 1, isPrimary: false }),
    row({ id: "tour", kind: "TOUR_360", sortOrder: 2, isPrimary: false }),
    row({ id: "photo", kind: "IMAGE", sortOrder: 3, isPrimary: false }),
  ];
  assert.deepEqual(
    toPublicGallery(mixed).map((media) => media.id),
    ["photo"]
  );
});

test("a listing whose only media is a floor plan has an empty public gallery", () => {
  // Not a cover that happens to be a floor plan — empty, so the card renders its
  // "no photos" placeholder.
  assert.deepEqual(toPublicGallery([row({ kind: "FLOOR_PLAN" })]), []);
});

test("an empty gallery is empty, in both projections", () => {
  assert.deepEqual(toSafeGallery([]), []);
  assert.deepEqual(toPublicGallery([]), []);
});

test("no row in either gallery leaks a storage detail", () => {
  assertNothingLeaked(toSafeGallery(THREE));
  assertNothingLeaked(toPublicGallery(THREE));
});
