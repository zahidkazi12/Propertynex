import "../stubs/patch-server-only";
import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEY_PREFIX,
  buildStorageKey,
  isSafeStorageKey,
  storageExtension,
  storageKeyPropertyId,
} from "../../lib/media/keys";
import { IMAGE_MIME_EXTENSIONS, IMAGE_MIME_TYPES } from "../../lib/media/constants";

/**
 * `lib/media/keys.ts` — where "malicious filenames" is answered by subtraction.
 *
 * The tests here are shaped by that design. There is no test for "strips `../`
 * from the filename" or "rejects a name containing a null byte", because the
 * uploaded filename is never an input: `buildStorageKey` takes a property id and
 * a MIME type, and that is the whole signature. The first test below pins exactly
 * that, because it is the property the rest of the module depends on — a future
 * change that added a `filename` parameter would reintroduce the entire class of
 * bug, and would break that assertion before it broke anything else.
 *
 * The other half is `isSafeStorageKey`, which runs on every read and delete rather
 * than only on writes. Its job is to be the thing standing between a tampered or
 * corrupted `storageKey` column and `readFile`, so it is tested against traversal,
 * separators, absolute paths, UNC prefixes and null bytes — not because this
 * module would ever generate one, but because the point is that it does not have
 * to have generated it.
 */

const PROPERTY_ID = "64b7c0f1a2d3e4f5a6b7c8d9";
const OTHER_PROPERTY_ID = "0123456789abcdef01234567";

test("a storage key cannot be derived from a filename: there is no parameter for one", () => {
  // Arity, asserted deliberately. The client's filename is not sanitised here —
  // it is structurally absent, and this is the assertion that keeps it absent.
  assert.equal(buildStorageKey.length, 2);
});

test("a key is prefix, property id, random material and extension — and nothing else", () => {
  const key = buildStorageKey(PROPERTY_ID, "image/jpeg");
  assert.match(key, /^properties\/[0-9a-f]{24}\/[0-9a-f]{32}\.jpg$/);
  assert.equal(key.split("/")[0], STORAGE_KEY_PREFIX);
  assert.equal(key.split("/")[1], PROPERTY_ID);
  assert.ok(isSafeStorageKey(key));
});

test("the extension comes from the sniffed MIME type, one per accepted format", () => {
  for (const mimeType of IMAGE_MIME_TYPES) {
    const expected = IMAGE_MIME_EXTENSIONS[mimeType];
    assert.equal(storageExtension(mimeType), expected);
    const key = buildStorageKey(PROPERTY_ID, mimeType);
    assert.ok(key.endsWith(expected), `${mimeType} produced ${key}`);
    assert.ok(isSafeStorageKey(key), `${mimeType} produced an unreadable key`);
  }
});

test("keys are unique and unguessable", () => {
  // 16 random bytes each. A thousand draws collapsing to fewer than a thousand
  // values would mean the randomness is not where it is supposed to be.
  const keys = new Set<string>();
  for (let i = 0; i < 1000; i += 1) keys.add(buildStorageKey(PROPERTY_ID, "image/png"));
  assert.equal(keys.size, 1000);
});

test("two properties never share a key namespace", () => {
  const mine = buildStorageKey(PROPERTY_ID, "image/png");
  const theirs = buildStorageKey(OTHER_PROPERTY_ID, "image/png");
  assert.equal(storageKeyPropertyId(mine), PROPERTY_ID);
  assert.equal(storageKeyPropertyId(theirs), OTHER_PROPERTY_ID);
  assert.notEqual(storageKeyPropertyId(mine), storageKeyPropertyId(theirs));
});

test("a property id that is not a canonical ObjectId is refused outright", () => {
  // The tripwire described in the module: callers take this from a row they have
  // already loaded and authorised. One that took it from the URL instead would
  // fail here rather than write a key with a path segment in it.
  const bad = [
    "",
    "../../etc",
    "64b7c0f1a2d3e4f5a6b7c8d",
    "64b7c0f1a2d3e4f5a6b7c8d99",
    "64B7C0F1A2D3E4F5A6B7C8D9",
    "64b7c0f1a2d3e4f5a6b7c8d/",
    "64b7c0f1a2d3e4f5a6b7c8dz",
    "64b7c0f1a2d3e4f5a6b7c8d9\0",
    "64b7c0f1a2d3e4f5a6b7c8d9/../../../etc/passwd",
  ];

  for (const propertyId of bad) {
    assert.throws(
      () => buildStorageKey(propertyId, "image/png"),
      /ObjectId/,
      `accepted ${JSON.stringify(propertyId)}`
    );
  }
});

test("isSafeStorageKey accepts exactly what this module produces", () => {
  const random = "a".repeat(32);
  for (const extension of Object.values(IMAGE_MIME_EXTENSIONS)) {
    assert.ok(isSafeStorageKey(`${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}${extension}`));
  }
});

test("isSafeStorageKey refuses anything that could escape the storage root", () => {
  const random = "b".repeat(32);
  const valid = `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}.png`;
  assert.ok(isSafeStorageKey(valid), "the control case must pass");

  const hostile: Record<string, string> = {
    "posix traversal": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/../../../../etc/passwd`,
    "traversal inside a segment": `${STORAGE_KEY_PREFIX}/..${PROPERTY_ID}/${random}.png`,
    "dot segment": `${STORAGE_KEY_PREFIX}/./${PROPERTY_ID}/${random}.png`,
    "windows separator": `${STORAGE_KEY_PREFIX}\\${PROPERTY_ID}\\${random}.png`,
    "windows traversal": `..\\..\\Windows\\System32\\config\\SAM`,
    "drive letter": `C:\\Users\\me\\${random}.png`,
    "absolute posix path": `/etc/passwd`,
    "leading slash": `/${valid}`,
    "UNC path": `\\\\server\\share\\${random}.png`,
    "null byte": `${valid}\0.txt`,
    "null byte truncation": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}.png\0`,
    "trailing newline": `${valid}\n`,
    "leading newline": `\n${valid}`,
    "trailing space": `${valid} `,
    "url encoded traversal": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/%2e%2e%2f${random}.png`,
    "wrong prefix": `uploads/${PROPERTY_ID}/${random}.png`,
    "no prefix": `${PROPERTY_ID}/${random}.png`,
    "extra depth": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/nested/${random}.png`,
    "uppercase property id": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID.toUpperCase()}/${random}.png`,
    "uppercase random": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random.toUpperCase()}.png`,
    "short random": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/abc.png`,
    "no extension": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}`,
    "svg extension": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}.svg`,
    "double extension": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}.png.php`,
    "uppercase extension": `${STORAGE_KEY_PREFIX}/${PROPERTY_ID}/${random}.PNG`,
    "query string": `${valid}?raw=1`,
    "fragment": `${valid}#/../../etc/passwd`,
    empty: "",
  };

  for (const [label, key] of Object.entries(hostile)) {
    assert.equal(isSafeStorageKey(key), false, `${label} was accepted: ${JSON.stringify(key)}`);
    // And the driver's second question gets the same answer, so a key that fails
    // the check can never be used to locate a directory either.
    assert.equal(storageKeyPropertyId(key), null, `${label} yielded a property id`);
  }
});

test("every key this module generates survives a round trip through both checks", () => {
  // The property that matters operationally: a file that can be written must be
  // readable and deletable. A stricter validator than the generator would leave
  // orphans behind on every upload.
  for (let i = 0; i < 200; i += 1) {
    const mimeType = IMAGE_MIME_TYPES[i % IMAGE_MIME_TYPES.length];
    const key = buildStorageKey(PROPERTY_ID, mimeType);
    assert.ok(isSafeStorageKey(key), key);
    assert.equal(storageKeyPropertyId(key), PROPERTY_ID);
  }
});
