import "../stubs/patch-server-only";
import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { localStorageRoot, resolveStoragePath } from "../../lib/media/storage/local";
import { buildStorageKey } from "../../lib/media/keys";
import { IMAGE_MIME_TYPES } from "../../lib/media/constants";

/**
 * `lib/media/storage/local.ts` — key to filesystem path.
 *
 * The module's own header names this file as the place to pin traversal
 * behaviour, and it is the right place: `resolveStoragePath` is a pure function of
 * (root, key), so every hostile key can be checked without touching a disk.
 *
 * What is being defended is narrower than it looks. `isSafeStorageKey` already
 * makes traversal unrepresentable, and this function calls it first — so the
 * second guard here (re-resolve, then prove the result is still under the root)
 * exists for the day someone loosens that pattern. Testing both layers separately
 * is the only way to notice if one of them quietly stops doing anything.
 */

const PROPERTY_ID = "64b7c0f1a2d3e4f5a6b7c8d9";
/** An absolute root that exists on neither platform, so nothing here can touch a
 *  real file even if a resolution went wrong. */
const ROOT = path.resolve(path.sep === "\\" ? "C:\\propertynex-test-root" : "/propertynex-test-root");

// ─────────────────────────────────────────────────────────────
// The root itself
// ─────────────────────────────────────────────────────────────

test("the storage root is not inside public/, where the static handler would serve it", () => {
  // The whole reason bytes go through `/api/media/[id]`. A root under `public/`
  // would make every DRAFT listing's photos world-readable before any code ran.
  const previous = process.env.MEDIA_STORAGE_DIR;
  delete process.env.MEDIA_STORAGE_DIR;
  try {
    const root = localStorageRoot();
    assert.equal(path.basename(root), ".media-storage");
    assert.ok(path.isAbsolute(root), root);

    const publicDir = path.resolve(process.cwd(), "public");
    assert.ok(
      path.relative(publicDir, root).startsWith(".."),
      `the storage root is inside public/: ${root}`
    );
  } finally {
    if (previous === undefined) delete process.env.MEDIA_STORAGE_DIR;
    else process.env.MEDIA_STORAGE_DIR = previous;
  }
});

test("the storage root is configurable through the environment", () => {
  // So a container can mount a volume for it. The value is a path, not a
  // credential — a driver that needs credentials keeps them in the environment too.
  const previous = process.env.MEDIA_STORAGE_DIR;
  try {
    process.env.MEDIA_STORAGE_DIR = "var/media";
    assert.equal(localStorageRoot(), path.resolve(process.cwd(), "var", "media"));

    // Blank is treated as unset rather than as "the working directory".
    process.env.MEDIA_STORAGE_DIR = "   ";
    assert.equal(path.basename(localStorageRoot()), ".media-storage");
  } finally {
    if (previous === undefined) delete process.env.MEDIA_STORAGE_DIR;
    else process.env.MEDIA_STORAGE_DIR = previous;
  }
});

// ─────────────────────────────────────────────────────────────
// Key → path
// ─────────────────────────────────────────────────────────────

test("a generated key resolves to the layout the driver documents", () => {
  const key = buildStorageKey(PROPERTY_ID, "image/jpeg");
  const resolved = resolveStoragePath(ROOT, key);
  assert.notEqual(resolved, null);

  const [prefix, propertyId, file] = key.split("/");
  assert.equal(resolved, path.join(ROOT, prefix, propertyId, file));
  assert.equal(path.basename(path.dirname(resolved as string)), PROPERTY_ID);
});

test("every accepted format resolves, so nothing can be written but not read back", () => {
  for (const mimeType of IMAGE_MIME_TYPES) {
    const key = buildStorageKey(PROPERTY_ID, mimeType);
    assert.notEqual(resolveStoragePath(ROOT, key), null, `${mimeType} produced an unresolvable key`);
  }
});

test("resolution is stable, and scoped to the root it was given", () => {
  const key = buildStorageKey(PROPERTY_ID, "image/png");
  assert.equal(resolveStoragePath(ROOT, key), resolveStoragePath(ROOT, key));

  const other = path.join(ROOT, "elsewhere");
  assert.notEqual(resolveStoragePath(other, key), resolveStoragePath(ROOT, key));
});

test("a root given with a trailing separator resolves the same way", () => {
  // The boundary check appends a separator only when one is missing; getting that
  // backwards would refuse every key under a root written as `/var/media/`.
  const key = buildStorageKey(PROPERTY_ID, "image/webp");
  assert.equal(resolveStoragePath(ROOT + path.sep, key), resolveStoragePath(ROOT, key));
});

test("no key can address a file outside the storage root", () => {
  const random = "c".repeat(32);
  const hostile: Record<string, string> = {
    "posix traversal": `properties/${PROPERTY_ID}/../../../../etc/passwd`,
    "traversal as the property segment": `properties/../../${random}.png`,
    "dot segment": `properties/./${PROPERTY_ID}/${random}.png`,
    "windows separators": `properties\\${PROPERTY_ID}\\${random}.png`,
    "windows traversal": `..\\..\\Windows\\System32\\config\\SAM`,
    "absolute posix path": "/etc/passwd",
    "absolute windows path": "C:\\Windows\\System32\\config\\SAM",
    "UNC path": `\\\\server\\share\\${random}.png`,
    "leading slash": `/properties/${PROPERTY_ID}/${random}.png`,
    "null byte": `properties/${PROPERTY_ID}/${random}.png\0`,
    "url encoded traversal": `properties/${PROPERTY_ID}/%2e%2e%2f${random}.png`,
    "wrong prefix": `uploads/${PROPERTY_ID}/${random}.png`,
    "extra depth": `properties/${PROPERTY_ID}/nested/${random}.png`,
    "svg extension": `properties/${PROPERTY_ID}/${random}.svg`,
    "double extension": `properties/${PROPERTY_ID}/${random}.png.php`,
    "no extension": `properties/${PROPERTY_ID}/${random}`,
    empty: "",
  };

  for (const [label, key] of Object.entries(hostile)) {
    assert.equal(resolveStoragePath(ROOT, key), null, `${label} resolved to a path`);
  }
});

test("anything that does resolve is provably under the root", () => {
  // The property the two guards exist to provide, stated once as an invariant over
  // both the safe and the hostile inputs rather than case by case.
  const random = "d".repeat(32);
  const candidates = [
    buildStorageKey(PROPERTY_ID, "image/jpeg"),
    buildStorageKey(PROPERTY_ID, "image/avif"),
    `properties/${PROPERTY_ID}/${random}.png`,
    `properties/${PROPERTY_ID}/../${random}.png`,
    `properties/${PROPERTY_ID}/${random}.png/../../..`,
    "../outside.png",
    "",
  ];

  const boundary = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  for (const key of candidates) {
    const resolved = resolveStoragePath(ROOT, key);
    if (resolved !== null) {
      assert.ok(resolved.startsWith(boundary), `${key} escaped the root as ${resolved}`);
    }
  }
});
