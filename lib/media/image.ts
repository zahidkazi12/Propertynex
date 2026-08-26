import "server-only";

/**
 * Byte-level image validation: what a file *is*, not what it was labelled.
 *
 * ── Why the Content-Type header is not evidence ──────────────────────────────
 *
 * In a multipart upload the per-part `Content-Type` is chosen by the client. It
 * is a hint from the file picker, and `curl -F 'file=@shell.php;type=image/jpeg'`
 * sets it to anything at all. The filename extension is no better. So neither is
 * consulted when deciding whether to store a file:
 *
 *   1. The format is identified from the file's own leading bytes (its "magic
 *      number"), and only the four in `IMAGE_MIME_EXTENSIONS` are recognised.
 *   2. The intrinsic dimensions are then parsed out of that format's header. A
 *      file whose header cannot be walked is rejected rather than stored, which
 *      means a `.jpg` that is really a ZIP, an HTML page, or a PHP script fails
 *      at step 1, and a truncated or hand-mangled JPEG fails at step 2.
 *   3. The `mimeType` written to the database is the one *this* module concluded,
 *      not the one the upload claimed — and that stored value is what
 *      `/api/media/[id]` later sends back as the response `Content-Type`. The
 *      byte inspection therefore protects the eventual render, not just the write.
 *
 * ── Why parsing is hand-written ─────────────────────────────────────────────
 *
 * This project has no image library in its dependency tree, and reading four
 * fixed-offset headers is not a reason to add one — an image *decoder* is a large
 * attack surface, while a header *reader* touches at most a few hundred bytes and
 * never decompresses anything. Nothing here allocates based on a value read from
 * the file, every read is bounds-checked against the buffer length, and no loop
 * can advance by zero. `tests/unit/media-image.test.ts` pins the behaviour,
 * including the hostile cases.
 *
 * Pure functions over a `Buffer`: no filesystem, no database, no network.
 */
import { createHash } from "node:crypto";
import {
  IMAGE_FORMAT_SUMMARY,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_DIMENSION,
  formatBytes,
  type ImageMimeType,
} from "@/lib/media/constants";

// ─────────────────────────────────────────────────────────────
// Result shape
// ─────────────────────────────────────────────────────────────

export type ImageRejectReason =
  | "empty"
  | "too-large"
  | "unsupported-format"
  | "unreadable-dimensions"
  | "too-small"
  | "too-many-pixels";

export type ImageProbe =
  | {
      readonly ok: true;
      readonly mimeType: ImageMimeType;
      readonly width: number;
      readonly height: number;
      readonly byteSize: number;
    }
  | { readonly ok: false; readonly reason: ImageRejectReason };

/**
 * One message per rejection reason.
 *
 * Deliberately specific — "that file isn't an image" when the real problem is a
 * 40 MB photo teaches the seller nothing, and they will simply try again. None of
 * these leaks anything about the server: they describe the file the caller
 * already has.
 */
export const IMAGE_REJECTION_MESSAGES: Record<ImageRejectReason, string> = {
  empty: "That file is empty.",
  "too-large": `Images must be ${formatBytes(MAX_IMAGE_BYTES)} or smaller.`,
  "unsupported-format": `That file isn't a ${IMAGE_FORMAT_SUMMARY} image.`,
  "unreadable-dimensions":
    "That image's header could not be read, so the file looks damaged or incomplete.",
  "too-small": `Images must be at least ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION} pixels.`,
  "too-many-pixels": `That image has too many pixels (the limit is ${
    MAX_IMAGE_PIXELS / 1_000_000
  } megapixels).`,
};

export function imageRejectionMessage(reason: ImageRejectReason): string {
  return IMAGE_REJECTION_MESSAGES[reason];
}

type Size = { readonly width: number; readonly height: number };

// ─────────────────────────────────────────────────────────────
// Format identification
// ─────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Brands in an ISO-BMFF `ftyp` box that mean "this is AVIF". `avis` is an AVIF
 *  image sequence. HEIC's brands (`heic`, `heix`, `mif1` alone) are NOT here: no
 *  browser renders HEIC, so a HEIC file renamed `.avif` must fail. */
const AVIF_BRANDS: readonly string[] = ["avif", "avis"];

/** How far into an AVIF the `ispe` box is looked for. Real files put the `meta`
 *  box within the first few hundred bytes; 64 KB is generous and, crucially,
 *  bounded — an unbounded scan over an 8 MB buffer would be a free CPU sink. */
const AVIF_HEADER_WINDOW = 64 * 1024;

function ascii(buffer: Buffer, start: number, end: number): string {
  if (end > buffer.length) return "";
  return buffer.toString("latin1", start, end);
}

/** True for an ISO-BMFF file whose `ftyp` box declares an AVIF brand, in either
 *  the major brand or the compatible-brands list. */
function isAvifContainer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (ascii(buffer, 4, 8) !== "ftyp") return false;

  if (AVIF_BRANDS.includes(ascii(buffer, 8, 12))) return true;

  // Compatible brands follow the 4-byte minor version at offset 12. The box size
  // is attacker-controlled, so the scan is clamped to both it and the buffer.
  const declared = buffer.readUInt32BE(0);
  const end = Math.min(buffer.length, declared > 16 ? declared : 0, AVIF_HEADER_WINDOW);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.includes(ascii(buffer, offset, offset + 4))) return true;
  }
  return false;
}

/**
 * The file's real format, from its leading bytes — or null.
 *
 * Null is the answer for every format not on the allowlist, and for a file whose
 * first bytes are `<svg`, `<!DOCTYPE html`, `PK\x03\x04`, `<?php` or anything
 * else: there is no fallback branch that guesses.
 */
export function sniffImageFormat(buffer: Buffer): ImageMimeType | null {
  // JPEG: SOI marker.
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  // WebP is a RIFF container with a "WEBP" form type.
  if (
    buffer.length >= 12 &&
    ascii(buffer, 0, 4) === "RIFF" &&
    ascii(buffer, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (isAvifContainer(buffer)) return "image/avif";

  return null;
}

// ─────────────────────────────────────────────────────────────
// Dimension parsing, per format
// ─────────────────────────────────────────────────────────────

/**
 * JPEG: walk the marker segments to the Start-Of-Frame that carries the size.
 *
 * There is no fixed offset for it — the frame header sits after however many
 * APPn/COM/DQT segments the encoder emitted, so the segment chain has to be
 * followed. The loop is bounded three ways: every iteration either advances past
 * a marker (2 bytes) or past a whole segment (`length >= 2`), a segment length
 * below 2 is treated as corrupt, and reaching SOS or EOI without having seen a
 * SOF fails rather than continuing into entropy-coded data.
 */
function jpegSize(buffer: Buffer): Size | null {
  let offset = 2; // past the SOI

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;

    // 0xFF is legal padding before a marker byte.
    let marker = buffer[offset + 1];
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1;
      marker = buffer[offset + 1];
    }
    offset += 2;

    // Markers with no payload: TEM, RSTn, and a stray SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    // Start of compressed data, or end of image, with no frame header seen.
    if (marker === 0xda || marker === 0xd9) return null;

    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) return null;

    // SOF0..SOF15 minus the three markers that share the range but are not
    // frame headers: DHT (0xC4), JPG (0xC8) and DAC (0xCC).
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      // length(2) precision(1) height(2) width(2)
      if (offset + 7 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }

    offset += length;
  }

  return null;
}

/** PNG: the IHDR chunk is always first, at a fixed offset. */
function pngSize(buffer: Buffer): Size | null {
  if (buffer.length < 24) return null;
  if (ascii(buffer, 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * WebP: three bitstream flavours, three different places to look.
 *
 *   VP8   lossy     — 14-bit width/height after the 3-byte sync code.
 *   VP8L  lossless  — 14-bit width-1/height-1 packed into one little-endian word.
 *   VP8X  extended  — 24-bit canvas width-1/height-1 (the animated/alpha form).
 */
function webpSize(buffer: Buffer): Size | null {
  const chunk = ascii(buffer, 12, 16);

  if (chunk === "VP8 ") {
    if (buffer.length < 30) return null;
    // Keyframe sync code. Its absence means this is not a decodable still frame.
    if (!(buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a)) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    if (buffer.length < 25) return null;
    if (buffer[20] !== 0x2f) return null; // VP8L signature byte
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }

  if (chunk === "VP8X") {
    if (buffer.length < 30) return null;
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }

  return null;
}

const ISPE_BOX = Buffer.from("ispe", "latin1");

/**
 * AVIF: locate the `ispe` (image spatial extents) box.
 *
 * Unlike the other three, this is a *search* rather than a fixed offset, because
 * `ispe` is nested several boxes deep (`meta` → `iprp` → `ipco` → `ispe`) and the
 * intermediate boxes are variable length. Walking the full box tree to read two
 * integers would be a great deal more parser — and therefore more attack surface
 * — than finding the box header directly, so the search is used and bounded to
 * `AVIF_HEADER_WINDOW`. A file with no `ispe` in that window is rejected, which
 * is the correct outcome for both a malformed file and an exotic one this app
 * cannot describe.
 */
function avifSize(buffer: Buffer): Size | null {
  const window = buffer.subarray(0, Math.min(buffer.length, AVIF_HEADER_WINDOW));
  const index = window.indexOf(ISPE_BOX);
  // box: size(4) type(4)="ispe" version(1) flags(3) width(4) height(4)
  if (index < 0 || index + 16 > buffer.length) return null;
  return { width: buffer.readUInt32BE(index + 8), height: buffer.readUInt32BE(index + 12) };
}

function readSize(mimeType: ImageMimeType, buffer: Buffer): Size | null {
  switch (mimeType) {
    case "image/jpeg":
      return jpegSize(buffer);
    case "image/png":
      return pngSize(buffer);
    case "image/webp":
      return webpSize(buffer);
    case "image/avif":
      return avifSize(buffer);
  }
}

// ─────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────

/**
 * The single decision point for "may these bytes be stored as a property photo?"
 *
 * Order matters and is cheapest-first: size, then a 12-byte signature check, then
 * a header walk, then the dimension bounds. Nothing decodes pixel data at any
 * point, so a hostile file costs microseconds to refuse.
 *
 * Callers must treat a `false` result as final — there is no "store it anyway"
 * path, which is what makes `PropertyMedia.width`/`height` trustworthy for every
 * row this app writes.
 */
export function probeImage(buffer: Buffer): ImageProbe {
  if (buffer.length === 0) return { ok: false, reason: "empty" };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };

  const mimeType = sniffImageFormat(buffer);
  if (!mimeType) return { ok: false, reason: "unsupported-format" };

  const size = readSize(mimeType, buffer);
  if (!size) return { ok: false, reason: "unreadable-dimensions" };

  const { width, height } = size;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, reason: "unreadable-dimensions" };
  }

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    return { ok: false, reason: "too-small" };
  }

  // Pixel count before byte count is the point: a 300 KB file can still claim
  // 50000×50000, and it is the claim that costs a resizer its memory.
  if (width * height > MAX_IMAGE_PIXELS) {
    return { ok: false, reason: "too-many-pixels" };
  }

  return { ok: true, mimeType, width, height, byteSize: buffer.length };
}

/**
 * SHA-256 of the bytes, lowercase hex.
 *
 * Stored on the row so re-uploading a photo the listing already has is a no-op
 * instead of a duplicate tile — a real thing sellers do when an upload appears to
 * stall. Content identity, not a security control: it is never compared against
 * anything a client supplied.
 */
export function bytesChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
