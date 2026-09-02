import "server-only";

/**
 * Storage keys: the names bytes are filed under, and why none of them comes from
 * the person uploading.
 *
 * ── "Malicious filenames" is not a sanitisation problem here ─────────────────
 *
 * The usual approach is to take the client's filename and clean it — strip `..`,
 * strip slashes, strip null bytes, collapse unicode, watch for `CON`/`PRN` on
 * Windows, watch for a second extension, watch for a name that differs only by
 * case on one filesystem and not another. Every one of those is a rule that can
 * be missed, and the list is different per platform.
 *
 * This module removes the problem instead of filtering it: **the uploaded
 * filename is never used**. A key is composed entirely of server-generated
 * material — a fixed prefix, the property's own id, 16 bytes from
 * `randomBytes`, and an extension chosen from the MIME type that
 * `lib/media/image.ts` concluded from the file's magic bytes. There is no
 * concatenation of client input anywhere in it, so there is no traversal,
 * overwrite, shell-quoting or case-collision case to get right.
 *
 * The original filename is not stored either. It would be client-controlled text
 * that later wants rendering, and the field that *is* rendered — `alt` — is
 * length-capped and owner-authored on purpose. A photo's provenance is not worth
 * an XSS sink.
 *
 * ── The key is checked on the way out as well ───────────────────────────────
 *
 * `isSafeStorageKey` is a whole-string allowlist, not a blocklist, and the local
 * driver runs it on every read and delete — not only on the writes this module
 * generated. That is what makes a tampered or corrupted `storageKey` column
 * unable to become an arbitrary file read: a row whose key does not match this
 * exact shape resolves to nothing at all.
 */
import { randomBytes } from "node:crypto";
import { IMAGE_MIME_EXTENSIONS, type ImageMimeType } from "@/lib/media/constants";
import { isValidRecordId } from "@/lib/utils/record-id";

/** Every key lives under this prefix, so a storage root shared with something
 *  else later stays legible. */
export const STORAGE_KEY_PREFIX = "properties";

/** 16 bytes → 32 hex characters. Far beyond any collision concern, and — more to
 *  the point — unguessable, so a key is not a resource an attacker can enumerate
 *  even in a deployment that misconfigures its bucket. */
const KEY_RANDOM_BYTES = 16;

const ALLOWED_EXTENSIONS: readonly string[] = Object.values(IMAGE_MIME_EXTENSIONS);

/**
 * The property-id segment of a key, as *read back*.
 *
 * Deliberately wider than the id shape this application now issues. Ids used to
 * be MongoDB ObjectIds (24 hex characters) and are now CUIDs
 * (`lib/utils/record-id.ts`); a storage key is a historical artifact, so its
 * shape is whatever produced it, not whatever the current schema would produce.
 * Narrowing this to CUIDs alone would make every key written before the
 * migration fail validation on read — and `isSafeStorageKey` is what the local
 * driver consults before *every* read and delete, so those rows' files would
 * become unreachable rather than merely legacy.
 *
 * `buildStorageKey` below is the opposite: it may only ever *produce* the current
 * shape.
 */
const KEY_PROPERTY_SEGMENT = "(?:c[a-z0-9]{24}|[0-9a-f]{24})";

/**
 * The one legal key shape.
 *
 * Anchored at both ends, with no `.` outside the extension and no character class
 * that admits a separator, a dot-segment, a drive letter, a UNC prefix or a null
 * byte. Built from the extension list so a new accepted format cannot be storable
 * but unreadable.
 */
const STORAGE_KEY_PATTERN = new RegExp(
  `^${STORAGE_KEY_PREFIX}/${KEY_PROPERTY_SEGMENT}/[0-9a-f]{32}(?:${ALLOWED_EXTENSIONS.map(
    (extension) => extension.replace(".", "\\.")
  ).join("|")})$`
);

export function storageExtension(mimeType: ImageMimeType): string {
  return IMAGE_MIME_EXTENSIONS[mimeType];
}

/**
 * A fresh, opaque key for one file.
 *
 * `propertyId` is expected to be a validated record id — the callers all take it
 * from a row they have already loaded and authorised, never from a request
 * parameter directly. The assertion below is a tripwire for a future caller that
 * forgets that, not a substitute for `isValidRecordId` at the boundary.
 *
 * It asserts the *current* id shape rather than the wider one `STORAGE_KEY_PATTERN`
 * accepts: reading a pre-migration key is legitimate, writing a new one in that
 * old shape is not.
 */
export function buildStorageKey(propertyId: string, mimeType: ImageMimeType): string {
  if (!isValidRecordId(propertyId)) {
    throw new Error("buildStorageKey: propertyId must be a CUID");
  }

  const random = randomBytes(KEY_RANDOM_BYTES).toString("hex");
  return `${STORAGE_KEY_PREFIX}/${propertyId}/${random}${storageExtension(mimeType)}`;
}

/**
 * True only for a key this module could have produced.
 *
 * Deliberately strict rather than forgiving: the cost of a false negative is one
 * orphaned file, and the cost of a false positive is an arbitrary path handed to
 * `readFile`.
 */
export function isSafeStorageKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key);
}

/** The property segment of a key, or null if the key is not well-formed. Used by
 *  the local driver to prune a listing's directory once it is empty. */
export function storageKeyPropertyId(key: string): string | null {
  if (!isSafeStorageKey(key)) return null;
  return key.split("/")[1] ?? null;
}
