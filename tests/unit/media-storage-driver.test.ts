import "../stubs/patch-server-only";
import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import { MEDIA_STORAGE_DRIVERS, resolveDriver } from "../../lib/media/storage/index";
import { createVercelBlobMediaStorage, resolveBlobAccess } from "../../lib/media/storage/vercel-blob";
import { buildStorageKey } from "../../lib/media/keys";

/**
 * Driver selection, and the guards the Vercel Blob driver applies before it ever
 * reaches the network.
 *
 * ── What is and is not testable here ────────────────────────────────────────
 *
 * Nothing in this file talks to a Blob store, and nothing in it needs to. The two
 * claims worth pinning are both decided before any request is made:
 *
 *   1. **Which driver a deployment gets**, including the case that caused the
 *      production failure this driver exists for — `local` on Vercel, where the
 *      filesystem is read-only and no value of `MEDIA_STORAGE_DIR` helps.
 *   2. **That an unsafe `storageKey` never becomes a store operation**, the same
 *      property `media-storage-key.test.ts` pins for the local driver. There the
 *      guard is "does it resolve to a path"; here it is "is a request issued at
 *      all", so the assertion is that a hostile key throws or no-ops *without*
 *      network access — which a test with no credentials to a real store can
 *      state precisely, because any leak past the guard would fail differently.
 *
 * Upload, read-back and delete against a live store are integration concerns and
 * are listed as such in the README rather than faked here: a mocked `put` would
 * only assert that this file calls the function it obviously calls.
 */

/** A syntactically valid CUID, for keys that are supposed to pass the guard. */
const PROPERTY_ID = "c64b7c0f1a2d3e4f5a6b7c8d9";

/** Shaped like a real token so nothing rejects it for its format, and inert: every
 *  test that sets it asserts a failure that happens before a request. */
const FAKE_TOKEN = "vercel_blob_rw_TESTONLY_notarealcredential";

const BLOB_ENV_KEYS = [
  "MEDIA_STORAGE_DRIVER",
  "MEDIA_BLOB_ACCESS",
  "VERCEL",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "VERCEL_OIDC_TOKEN",
] as const;

const SAVED_ENV = { ...process.env };

/**
 * Run `body` with the given environment, then restore it.
 *
 * Every variable this file touches is cleared first, not just the ones being set:
 * a machine that has run `vercel env pull` has `BLOB_READ_WRITE_TOKEN` and
 * `VERCEL` in its `.env`, and a test asserting "no credential configured" would
 * otherwise pass or fail depending on whose machine it ran on.
 */
function withEnv<T>(overrides: Partial<Record<(typeof BLOB_ENV_KEYS)[number], string>>, body: () => T): T {
  for (const key of BLOB_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

  try {
    return body();
  } finally {
    for (const key of BLOB_ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Which driver a deployment gets
// ─────────────────────────────────────────────────────────────

test("the default driver depends on where the code is running", () => {
  // The whole point of the per-environment default: a local checkout keeps writing
  // to disk, and a Vercel deployment does not silently try to.
  assert.equal(withEnv({}, resolveDriver), "local");
  assert.equal(withEnv({ VERCEL: "1" }, resolveDriver), "vercel-blob");
});

test("VERCEL is read as a flag, not as any non-empty string", () => {
  // "1" is what Vercel sets. Treating an arbitrary value as truthy would make a
  // local `VERCEL=false` in a .env file silently switch the driver.
  assert.equal(withEnv({ VERCEL: "true" }, resolveDriver), "vercel-blob");
  assert.equal(withEnv({ VERCEL: "0" }, resolveDriver), "local");
  assert.equal(withEnv({ VERCEL: "false" }, resolveDriver), "local");
  assert.equal(withEnv({ VERCEL: "" }, resolveDriver), "local");
});

test("an explicit driver name wins over the default, and is read leniently", () => {
  assert.equal(withEnv({ MEDIA_STORAGE_DRIVER: "vercel-blob" }, resolveDriver), "vercel-blob");
  assert.equal(withEnv({ MEDIA_STORAGE_DRIVER: "  VERCEL-BLOB  " }, resolveDriver), "vercel-blob");
  // Blank is "unset", not "the empty driver".
  assert.equal(withEnv({ MEDIA_STORAGE_DRIVER: "   " }, resolveDriver), "local");
  assert.equal(withEnv({ MEDIA_STORAGE_DRIVER: "   ", VERCEL: "1" }, resolveDriver), "vercel-blob");
});

test("an unknown driver name is a hard error, not a fallback to the local disk", () => {
  // The fail-closed case the module header argues for: a deployment that believes
  // it writes to a bucket must not quietly write to an ephemeral filesystem.
  for (const name of ["s3", "vercel_blob", "blob", "localhost", "LOCAL_DISK"]) {
    assert.throws(
      () => withEnv({ MEDIA_STORAGE_DRIVER: name }, resolveDriver),
      /is not a known media storage driver/,
      `${name} was accepted`
    );
  }
});

test("the error for an unknown driver names the drivers that do exist", () => {
  assert.throws(
    () => withEnv({ MEDIA_STORAGE_DRIVER: "s3" }, resolveDriver),
    (error: unknown) => {
      const message = (error as Error).message;
      for (const driver of MEDIA_STORAGE_DRIVERS) {
        assert.ok(message.includes(driver), `the message omits "${driver}": ${message}`);
      }
      return true;
    }
  );
});

test('MEDIA_STORAGE_DRIVER="local" is refused on Vercel rather than obeyed', () => {
  // The regression this driver was added for. Obeying it produces
  // `ENOENT: mkdir '/var/task/.media-storage'` at the first upload; refusing it
  // produces a sentence about configuration.
  assert.throws(
    () => withEnv({ MEDIA_STORAGE_DRIVER: "local", VERCEL: "1" }, resolveDriver),
    /cannot work on Vercel/
  );

  // …and only on Vercel. The same setting off-platform is the normal case.
  assert.equal(withEnv({ MEDIA_STORAGE_DRIVER: "local" }, resolveDriver), "local");
});

// ─────────────────────────────────────────────────────────────
// Access mode
// ─────────────────────────────────────────────────────────────

test("blob access defaults to private, the mode that keeps drafts private", () => {
  // A public blob is served off the CDN by URL with no application code in the
  // path, so defaulting to public would put unpublished listings' photos on a
  // reachable URL — the objection that also keeps the local root out of public/.
  assert.equal(withEnv({}, resolveBlobAccess), "private");
  assert.equal(withEnv({ MEDIA_BLOB_ACCESS: "   " }, resolveBlobAccess), "private");
});

test("blob access is configurable, because a store's mode is fixed at creation", () => {
  assert.equal(withEnv({ MEDIA_BLOB_ACCESS: "public" }, resolveBlobAccess), "public");
  assert.equal(withEnv({ MEDIA_BLOB_ACCESS: "  PRIVATE  " }, resolveBlobAccess), "private");
});

test("an unrecognised access mode throws instead of degrading to public", () => {
  // Fail-closed for the same reason as the driver name. Reading `Privte` as
  // "public" would publish exactly what the private default exists to protect.
  for (const value of ["Privte", "restricted", "protected", "true", "0"]) {
    assert.throws(
      () => withEnv({ MEDIA_BLOB_ACCESS: value }, resolveBlobAccess),
      /is not a valid Vercel Blob access mode/,
      `${value} was accepted`
    );
  }
});

// ─────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────

test("the blob driver refuses to be constructed with no credential", () => {
  // Fails at construction with a sentence naming the variable, rather than at the
  // first upload with an SDK authentication error.
  assert.throws(
    () => withEnv({}, createVercelBlobMediaStorage),
    /needs a Blob credential/
  );
});

test("either credential form satisfies the check, and half an OIDC setup does not", () => {
  // OIDC needs both halves; Vercel provides both when a store is connected. A
  // deployment holding only one is misconfigured and should say so.
  assert.throws(() => withEnv({ BLOB_STORE_ID: "store_test" }, createVercelBlobMediaStorage), /needs a Blob credential/);
  assert.throws(() => withEnv({ VERCEL_OIDC_TOKEN: FAKE_TOKEN }, createVercelBlobMediaStorage), /needs a Blob credential/);

  assert.equal(
    withEnv({ BLOB_STORE_ID: "store_test", VERCEL_OIDC_TOKEN: FAKE_TOKEN }, () =>
      createVercelBlobMediaStorage().name
    ),
    "vercel-blob"
  );
  assert.equal(
    withEnv({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN }, () => createVercelBlobMediaStorage().name),
    "vercel-blob"
  );
});

test("a blank credential is not a credential", () => {
  assert.throws(
    () => withEnv({ BLOB_READ_WRITE_TOKEN: "   " }, createVercelBlobMediaStorage),
    /needs a Blob credential/
  );
});

test("the driver name is what gets persisted to storageDriver", () => {
  // `PropertyMedia.storageDriver` records where a row's bytes went, so this string
  // is data in the database. It must match the name `MEDIA_STORAGE_DRIVER` selects,
  // or a row written under one name becomes unreadable under the other.
  const name = withEnv({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN }, () => createVercelBlobMediaStorage().name);
  assert.ok((MEDIA_STORAGE_DRIVERS as readonly string[]).includes(name), name);
});

test("credential failures are not memoised at module scope", () => {
  // A deployment that adds the missing variable and restarts must get a working
  // driver — so construction is retried, not remembered as failed.
  assert.throws(() => withEnv({}, createVercelBlobMediaStorage), /needs a Blob credential/);
  assert.equal(
    withEnv({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN }, () => createVercelBlobMediaStorage().name),
    "vercel-blob"
  );
  assert.throws(() => withEnv({}, createVercelBlobMediaStorage), /needs a Blob credential/);
});

// ─────────────────────────────────────────────────────────────
// The key guard, before any request
// ─────────────────────────────────────────────────────────────

/**
 * Keys that `isSafeStorageKey` must reject.
 *
 * The same set of shapes `media-storage-key.test.ts` uses against the local
 * driver. Traversal is meaningless to an object store — a slash is just a folder
 * delimiter — but the guard is not about traversal here: a `storageKey` column
 * that has been tampered with or corrupted must not become an arbitrary object
 * fetch or delete in the store, and the row's key is the only input.
 */
const HOSTILE_KEYS: Record<string, string> = {
  "posix traversal": `properties/${PROPERTY_ID}/../../../../etc/passwd`,
  "dot segment": `properties/./${PROPERTY_ID}/${"a".repeat(32)}.png`,
  "windows separators": `properties\\${PROPERTY_ID}\\${"a".repeat(32)}.png`,
  "absolute path": "/etc/passwd",
  "leading slash": `/properties/${PROPERTY_ID}/${"a".repeat(32)}.png`,
  "null byte": `properties/${PROPERTY_ID}/${"a".repeat(32)}.png\0`,
  "url encoded traversal": `properties/${PROPERTY_ID}/%2e%2e%2f${"a".repeat(32)}.png`,
  "wrong prefix": `uploads/${PROPERTY_ID}/${"a".repeat(32)}.png`,
  "extra depth": `properties/${PROPERTY_ID}/nested/${"a".repeat(32)}.png`,
  "svg extension": `properties/${PROPERTY_ID}/${"a".repeat(32)}.svg`,
  "double extension": `properties/${PROPERTY_ID}/${"a".repeat(32)}.png.php`,
  "no extension": `properties/${PROPERTY_ID}/${"a".repeat(32)}`,
  "a whole other store's prefix": "*",
  "folder listing": "properties/",
  empty: "",
};

test("an unsafe key is never written", async () => {
  // Throws rather than returning quietly: a write is the caller asserting these
  // bytes must be stored, and a key it cannot store them under is a bug, not a
  // miss. No request is made, which is why this passes with an inert token.
  const storage = withEnv({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN }, createVercelBlobMediaStorage);
  const bytes = Buffer.from([0xff, 0xd8, 0xff]);

  for (const [label, key] of Object.entries(HOSTILE_KEYS)) {
    await assert.rejects(
      () => storage.put(key, bytes, "image/jpeg"),
      /refusing to write an unsafe key/,
      `${label} was accepted for writing`
    );
  }
});

test("an unsafe key reads as nothing there, and deletes as a no-op", async () => {
  // Matching the local driver: the serving route turns null into a 404, and a
  // malformed key genuinely does not identify an object. Both paths return before
  // the SDK is called — with no reachable store, anything else would throw.
  const storage = withEnv({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN }, createVercelBlobMediaStorage);

  for (const [label, key] of Object.entries(HOSTILE_KEYS)) {
    assert.equal(await storage.get(key), null, `${label} was read`);
    await assert.doesNotReject(() => storage.delete(key), `${label} was passed to delete`);
  }
});

test("a key this application generates passes the guard", () => {
  // The negative tests above are only meaningful if the positive case is not also
  // being rejected — a guard that refuses everything would pass all of them.
  const key = buildStorageKey(PROPERTY_ID, "image/jpeg");
  assert.match(key, /^properties\/c[a-z0-9]{24}\/[0-9a-f]{32}\.jpg$/);
});
