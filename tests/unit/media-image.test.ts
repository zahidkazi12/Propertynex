import "../stubs/patch-server-only";
import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_REJECTION_MESSAGES,
  bytesChecksum,
  imageRejectionMessage,
  probeImage,
  sniffImageFormat,
  type ImageRejectReason,
} from "../../lib/media/image";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_DIMENSION,
  formatBytes,
} from "../../lib/media/constants";

/**
 * `lib/media/image.ts` — the byte-level upload gate.
 *
 * This is the file that decides whether a set of bytes may be stored as a
 * property photo, so the interesting cases are the hostile ones: a PHP script
 * called `.jpg`, an SVG (a document that executes), a HEIC renamed `.avif`, a
 * 400-byte file that claims to be 50000×50000, a JPEG truncated mid-header.
 * Each has a test below, and each must fail for the *right* reason — a
 * decompression bomb refused as "unsupported format" would mean the pixel bound
 * is never actually reached.
 *
 * ── About the fixtures ──────────────────────────────────────────────────────
 *
 * The builders below emit real container headers, not opaque blobs: the module
 * under test reads magic bytes and then walks the format's own header, so a
 * placeholder buffer would be rejected for the wrong reason and prove nothing.
 * They stop at the header, though — no pixel data, no chunk CRCs — because
 * nothing here decodes or verifies either, and asserting behaviour the module
 * does not have would be asserting fiction.
 */

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG header: signature + a complete IHDR chunk. */
function png(width: number, height: number): Buffer {
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
 * The APP0 is not decoration — it is what makes reading the size a *walk* rather
 * than a fixed-offset read. A parser that assumed the frame header came first
 * would pass every test here if the segment were omitted, and then fail on every
 * photo a real camera writes.
 */
function jpeg(width: number, height: number, fillBytes = 0): Buffer {
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
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // three components; the nine bytes describing them stay zero

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    // Legal fill bytes ahead of the next marker.
    Buffer.alloc(fillBytes, 0xff),
    sof0,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riff(chunk: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(payload.length + 12, 4);
  header.write("WEBP", 8, "latin1");
  header.write(chunk, 12, "latin1");
  return Buffer.concat([header, payload]);
}

/** WebP, lossless bitstream: dimensions packed as two 14-bit (n-1) fields. */
function webpLossless(width: number, height: number): Buffer {
  const payload = Buffer.alloc(13);
  payload.writeUInt32LE(9, 0); // chunk size
  payload[4] = 0x2f; // VP8L signature byte
  payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 5);
  return riff("VP8L", payload);
}

/** WebP, lossy bitstream: a keyframe with its sync code and 14-bit dimensions. */
function webpLossy(width: number, height: number): Buffer {
  const payload = Buffer.alloc(18);
  payload.writeUInt32LE(14, 0);
  payload[7] = 0x9d; // sync code, at absolute offsets 23..25
  payload[8] = 0x01;
  payload[9] = 0x2a;
  payload.writeUInt16LE(width, 10);
  payload.writeUInt16LE(height, 12);
  return riff("VP8 ", payload);
}

/** WebP, extended (alpha/animation): 24-bit canvas size, also stored as n-1. */
function webpExtended(width: number, height: number): Buffer {
  const payload = Buffer.alloc(18);
  payload.writeUInt32LE(10, 0);
  payload.writeUIntLE(width - 1, 8, 3);
  payload.writeUIntLE(height - 1, 11, 3);
  return riff("VP8X", payload);
}

/** An ISO-BMFF file: an `ftyp` box declaring the given brands, then more boxes. */
function isoBmff(brands: readonly string[], rest: Buffer): Buffer {
  const size = 16 + Math.max(0, brands.length - 1) * 4;
  const ftyp = Buffer.alloc(size);
  ftyp.writeUInt32BE(size, 0);
  ftyp.write("ftyp", 4, "latin1");
  brands.forEach((brand, index) => {
    // Major brand at 8, minor version at 12, compatible brands from 16 onwards.
    ftyp.write(brand, index === 0 ? 8 : 12 + index * 4, "latin1");
  });
  return Buffer.concat([ftyp, rest]);
}

/** An `ispe` box — the only part of an AVIF this module looks for. */
function ispe(width: number, height: number): Buffer {
  const box = Buffer.alloc(20);
  box.writeUInt32BE(20, 0);
  box.write("ispe", 4, "latin1");
  // 8..11 are version + flags.
  box.writeUInt32BE(width, 12);
  box.writeUInt32BE(height, 16);
  return box;
}

function avif(width: number, height: number): Buffer {
  return isoBmff(["avif"], ispe(width, height));
}

/** Asserts acceptance and hands back the narrowed probe. */
function accepts(buffer: Buffer) {
  const probe = probeImage(buffer);
  if (!probe.ok) {
    assert.fail(`expected acceptance, got rejection "${probe.reason}"`);
  }
  return probe;
}

function rejects(buffer: Buffer, reason: ImageRejectReason) {
  const probe = probeImage(buffer);
  if (probe.ok) {
    assert.fail(`expected rejection "${reason}", got ${probe.width}×${probe.height}`);
  }
  assert.equal(probe.reason, reason);
}

// ─────────────────────────────────────────────────────────────
// Format identification
// ─────────────────────────────────────────────────────────────

test("each accepted format is identified from its own leading bytes", () => {
  assert.equal(sniffImageFormat(jpeg(400, 300)), "image/jpeg");
  assert.equal(sniffImageFormat(png(400, 300)), "image/png");
  assert.equal(sniffImageFormat(webpLossless(400, 300)), "image/webp");
  assert.equal(sniffImageFormat(avif(400, 300)), "image/avif");
});

test("an AVIF brand in the compatible-brands list still identifies the file", () => {
  // Real encoders write `mif1` as the major brand and list `avif` after it.
  const buffer = isoBmff(["mif1", "miaf", "avif"], ispe(640, 480));
  assert.equal(sniffImageFormat(buffer), "image/avif");
  assert.equal(accepts(buffer).width, 640);
});

test("a file's declared type is irrelevant: only the bytes are consulted", () => {
  // Exactly what `curl -F 'photo=@shell.php;type=image/jpeg'` uploads. The part
  // header says JPEG, the bytes say PHP, and the bytes win.
  const script = Buffer.from("<?php system($_GET['c']); ?>", "latin1");
  assert.equal(sniffImageFormat(script), null);
  rejects(script, "unsupported-format");
});

test("SVG is refused — it is a document, not a bitmap", () => {
  // The one that matters most: an SVG served from this origin executes its own
  // <script>, so accepting it would be stored XSS from any signed-up seller.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "latin1"
  );
  assert.equal(sniffImageFormat(svg), null);
  rejects(svg, "unsupported-format");
});

test("HEIC is refused even though it shares AVIF's container", () => {
  // No browser renders HEIC, so a phone photo renamed `.avif` must fail rather
  // than become a listing image that displays nothing.
  const heic = isoBmff(["heic", "mif1", "heic"], ispe(4032, 3024));
  assert.equal(sniffImageFormat(heic), null);
  rejects(heic, "unsupported-format");
});

test("formats with no dimension parser behind them are refused, not guessed", () => {
  const cases: Record<string, Buffer> = {
    gif: Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
    bmp: Buffer.from("BM\x36\x00\x00\x00", "latin1"),
    tiff: Buffer.from("II*\x00\x08\x00\x00\x00", "latin1"),
    ico: Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
    zip: Buffer.from("PK\x03\x04\x14\x00", "latin1"),
    html: Buffer.from("<!DOCTYPE html><html><body>hi</body></html>", "latin1"),
    pdf: Buffer.from("%PDF-1.7\n", "latin1"),
    elf: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
    text: Buffer.from("just some text, honestly", "latin1"),
  };

  for (const [label, buffer] of Object.entries(cases)) {
    assert.equal(sniffImageFormat(buffer), null, `${label} was identified as an image`);
    rejects(buffer, "unsupported-format");
  }
});

test("a truncated file is refused or read exactly — never past its end", () => {
  // Every prefix of every format, one byte at a time. None may throw, and any
  // prefix short enough to be accepted must still report the real dimensions
  // rather than whatever happened to be at the offset it wanted.
  const fixtures = [
    jpeg(400, 300),
    png(400, 300),
    webpLossless(400, 300),
    webpLossy(400, 300),
    webpExtended(400, 300),
    avif(400, 300),
  ];

  for (const full of fixtures) {
    for (let length = 0; length <= full.length; length += 1) {
      const probe = probeImage(full.subarray(0, length));
      if (probe.ok) {
        assert.equal(probe.width, 400, `a ${length}-byte prefix invented a width`);
        assert.equal(probe.height, 300, `a ${length}-byte prefix invented a height`);
      }
    }
    accepts(full);
  }
});

// ─────────────────────────────────────────────────────────────
// Dimension parsing
// ─────────────────────────────────────────────────────────────

test("dimensions are read out of each format's header", () => {
  for (const [label, buffer] of Object.entries({
    jpeg: jpeg(1280, 720),
    png: png(1280, 720),
    "webp lossless": webpLossless(1280, 720),
    "webp lossy": webpLossy(1280, 720),
    "webp extended": webpExtended(1280, 720),
    avif: avif(1280, 720),
  })) {
    const probe = accepts(buffer);
    assert.equal(probe.width, 1280, `${label}: wrong width`);
    assert.equal(probe.height, 720, `${label}: wrong height`);
    assert.equal(probe.byteSize, buffer.length, `${label}: wrong byte size`);
  }
});

test("width and height are not transposed", () => {
  // JPEG stores height before width, which is exactly the kind of thing a square
  // fixture would never catch.
  const probe = accepts(jpeg(800, 200));
  assert.equal(probe.width, 800);
  assert.equal(probe.height, 200);
});

test("0xFF fill bytes before a JPEG marker are tolerated", () => {
  const probe = accepts(jpeg(640, 480, 5));
  assert.equal(probe.width, 640);
  assert.equal(probe.height, 480);
});

test("a JPEG that reaches compressed data with no frame header is refused", () => {
  // SOI, then straight to SOS. Nothing declared a size, and the walk must not
  // wander into entropy-coded bytes hunting for one.
  const buffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]),
    Buffer.alloc(64, 0x5a),
  ]);
  assert.equal(sniffImageFormat(buffer), "image/jpeg");
  rejects(buffer, "unreadable-dimensions");
});

test("a JPEG segment claiming an impossible length is refused", () => {
  // A declared length below 2 would make the walk advance by zero or backwards,
  // so it has to be treated as corruption.
  const buffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]),
    Buffer.alloc(32, 0x00),
  ]);
  rejects(buffer, "unreadable-dimensions");
});

test("a PNG signature with a mangled header is refused", () => {
  const buffer = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64, 0x41)]);
  assert.equal(sniffImageFormat(buffer), "image/png");
  rejects(buffer, "unreadable-dimensions");
});

test("a WebP container with an unrecognised bitstream chunk is refused", () => {
  // `ANIM` with no `VP8X` canvas box: identifiable as WebP, unmeasurable.
  rejects(riff("ANIM", Buffer.alloc(32)), "unreadable-dimensions");
});

test("a WebP lossy frame with no keyframe sync code is refused", () => {
  const buffer = webpLossy(400, 300);
  buffer[24] = 0x00; // break the sync code
  rejects(buffer, "unreadable-dimensions");
});

test("an AVIF with no ispe box in the header window is refused", () => {
  rejects(isoBmff(["avif"], Buffer.alloc(256, 0x00)), "unreadable-dimensions");
});

test("a zero dimension is unreadable, not merely small", () => {
  rejects(png(0, 400), "unreadable-dimensions");
  rejects(png(400, 0), "unreadable-dimensions");
});

// ─────────────────────────────────────────────────────────────
// The bounds
// ─────────────────────────────────────────────────────────────

test("an empty file is refused as empty", () => {
  rejects(Buffer.alloc(0), "empty");
});

test("a file over the byte ceiling is refused before its bytes are inspected", () => {
  // Valid PNG bytes at the front on purpose: the size check has to fire first, or
  // the seller would be told the format was wrong when the size was the problem.
  const oversized = Buffer.concat([png(400, 300), Buffer.alloc(MAX_IMAGE_BYTES, 0x00)]);
  assert.ok(oversized.length > MAX_IMAGE_BYTES);
  rejects(oversized, "too-large");
});

test("a file exactly at the byte ceiling is accepted", () => {
  // The limit is inclusive. An off-by-one here would refuse a file the uploader
  // had just told the seller was fine.
  const header = png(400, 300);
  const exact = Buffer.concat([header, Buffer.alloc(MAX_IMAGE_BYTES - header.length, 0x00)]);
  assert.equal(exact.length, MAX_IMAGE_BYTES);
  accepts(exact);
});

test("an image smaller than the minimum on either side is refused", () => {
  rejects(png(MIN_IMAGE_DIMENSION - 1, 400), "too-small");
  rejects(png(400, MIN_IMAGE_DIMENSION - 1), "too-small");
  // A 1×1 tracking pixel is a valid PNG and not a photograph of a house.
  rejects(png(1, 1), "too-small");
  accepts(png(MIN_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION));
});

test("a decompression bomb is refused on its pixel count, not its file size", () => {
  // A few dozen bytes on the wire, 2.5 billion pixels once decoded. The byte
  // ceiling cannot see this; the header can, before anything allocates.
  const bomb = png(50_000, 50_000);
  assert.ok(bomb.length < 1024, "the fixture must be small for this test to mean anything");
  rejects(bomb, "too-many-pixels");
});

test("the pixel ceiling is exact", () => {
  const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS));
  accepts(png(side, side));
  rejects(png(side + 1, side + 1), "too-many-pixels");
});

test("a dimension at the format's own maximum does not overflow into acceptance", () => {
  // PNG stores dimensions as unsigned 32-bit, so this is the largest a file can
  // claim. The product overflows a signed 32-bit integer; JS numbers do not, and
  // the comparison must still refuse it.
  rejects(png(0xffffffff, 0xffffffff), "too-many-pixels");
});

// ─────────────────────────────────────────────────────────────
// Messages and checksums
// ─────────────────────────────────────────────────────────────

test("every rejection reason has a message, and none of them describes the server", () => {
  const reasons: readonly ImageRejectReason[] = [
    "empty",
    "too-large",
    "unsupported-format",
    "unreadable-dimensions",
    "too-small",
    "too-many-pixels",
  ];

  for (const reason of reasons) {
    const message = imageRejectionMessage(reason);
    assert.ok(message.length > 0, `${reason} has no message`);
    assert.equal(message, IMAGE_REJECTION_MESSAGES[reason]);
    // The seller reads these. They must describe the file, never a path, a
    // storage driver or a key.
    assert.doesNotMatch(message, /properties\/|storage|[A-Za-z]:\\|\/var\/|node_modules/i);
  }

  // Specific enough to act on: "that file isn't an image" for a 40 MB photo
  // teaches the seller nothing, so both numeric limits are named.
  assert.ok(imageRejectionMessage("too-large").includes(formatBytes(MAX_IMAGE_BYTES)));
  assert.ok(imageRejectionMessage("too-small").includes(String(MIN_IMAGE_DIMENSION)));
});

test("the reasons are distinguishable, so the wrong one is a visible bug", () => {
  const messages = Object.values(IMAGE_REJECTION_MESSAGES);
  assert.equal(new Set(messages).size, messages.length);
});

test("bytesChecksum is SHA-256 over the bytes, in lowercase hex", () => {
  // Pinned against the published digest of "abc" rather than against itself: a
  // self-comparison would pass for any hash function at all.
  assert.equal(
    bytesChecksum(Buffer.from("abc", "latin1")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("bytesChecksum is stable per content and separates different content", () => {
  const a = png(400, 300);
  const b = png(400, 301);
  assert.equal(bytesChecksum(a), bytesChecksum(Buffer.from(a)));
  assert.notEqual(bytesChecksum(a), bytesChecksum(b));
  assert.match(bytesChecksum(a), /^[0-9a-f]{64}$/);
});
