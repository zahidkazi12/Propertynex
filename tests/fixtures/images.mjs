/**
 * PROPERTYNEX — real image headers, for integration tests.
 *
 * The upload path decides what a file *is* by reading its magic bytes and then
 * walking the format's own header (`lib/media/image.ts`). An opaque blob would
 * therefore be rejected as "unsupported format" no matter what the test meant to
 * exercise, so these builders emit genuine containers: a PNG signature plus a
 * complete IHDR, a JPEG with an APP0 segment ahead of its SOF0, a RIFF/VP8L
 * WebP, an ISO-BMFF `ftyp` plus `ispe`.
 *
 * They stop at the header — no pixel data, no chunk CRCs — because nothing in
 * this app decodes or verifies either. A 33-byte "photo" is a real photo as far
 * as every check between the multipart parser and the database is concerned,
 * which is what makes a 20-image capacity test cost a kilobyte.
 *
 * ── Why these are duplicated from tests/unit/media-image.test.ts ─────────────
 *
 * They are not importable from there. The unit suite is TypeScript compiled to
 * CommonJS into `tests/.build/` (see tests/tsconfig.json), and a CommonJS module
 * cannot `require` an ESM `.mjs`. Sharing one copy would mean either compiling
 * the integration suite too — it is deliberately plain ESM so it runs with no
 * build step — or shipping the fixtures as an app module, which they are not.
 * Two short copies, each idiomatic to its runner, beats a build-graph edge.
 *
 * ── Uniqueness by dimension, not by padding ─────────────────────────────────
 *
 * De-duplication is by SHA-256 of the bytes, so a test that needs N distinct
 * images needs N distinct byte strings. These vary the *declared dimensions*
 * rather than appending salt: trailing garbage past the header would be bytes no
 * parser here reads, which makes "distinct" an accident of the fixture instead
 * of a property of the image. Two calls with the same arguments are byte-identical
 * — that is how the duplicate tests get their duplicate.
 */
import { createHash } from "node:crypto";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG header: signature + a complete IHDR chunk. 33 bytes. */
export function png(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk data length
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // colour type: truecolour
  // 18..20 are compression/filter/interlace, all zero; 21..24 stand in for the CRC.
  return Buffer.concat([PNG_SIGNATURE, ihdr]);
}

/**
 * A JPEG header: SOI, an APP0 segment, then the SOF0 that carries the size.
 *
 * The APP0 is what makes reading the size a *walk* rather than a fixed-offset
 * read, so it stays in even though nothing here inspects it.
 */
export function jpeg(width, height) {
  const app0 = Buffer.alloc(18);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2); // segment length, counting these two bytes
  app0.write("JFIF\0", 4, "latin1");

  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8; // sample precision
  // Height before width — JPEG's order, and the one a transposition bug survives.
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // three components; the nine bytes describing them stay zero

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.from([0xff, 0xd9])]);
}

/** WebP, lossless bitstream: dimensions packed as two 14-bit (n-1) fields. */
export function webpLossless(width, height) {
  const payload = Buffer.alloc(13);
  payload.writeUInt32LE(9, 0); // chunk size
  payload[4] = 0x2f; // VP8L signature byte
  payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 5);

  const header = Buffer.alloc(16);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(payload.length + 12, 4);
  header.write("WEBP", 8, "latin1");
  header.write("VP8L", 12, "latin1");
  return Buffer.concat([header, payload]);
}

/** An AVIF: an `ftyp` box declaring the brand, then the `ispe` that sizes it. */
export function avif(width, height) {
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "latin1");
  ftyp.write("avif", 8, "latin1");

  const ispe = Buffer.alloc(20);
  ispe.writeUInt32BE(20, 0);
  ispe.write("ispe", 4, "latin1");
  // 8..11 are version + flags.
  ispe.writeUInt32BE(width, 12);
  ispe.writeUInt32BE(height, 16);

  return Buffer.concat([ftyp, ispe]);
}

/**
 * Bytes that are not an image in any format on the allowlist.
 *
 * A PHP one-liner rather than random noise, because that is the actual upload
 * this gate exists for: `curl -F 'photo=@shell.php;type=image/jpeg'`.
 */
export function notAnImage() {
  return Buffer.from("<?php system($_GET['c']); ?>", "latin1");
}

/**
 * Valid PNG bytes padded past the per-file ceiling.
 *
 * The header is real and at the front on purpose: the size check has to fire
 * before the format check, or the seller is told the format was wrong when the
 * size was the problem.
 */
export function oversizedPng(maxBytes) {
  const header = png(400, 300);
  return Buffer.concat([header, Buffer.alloc(maxBytes - header.length + 1, 0x00)]);
}

/** SHA-256 in lowercase hex — the same digest `lib/media/image.ts` stores. */
export function checksum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
