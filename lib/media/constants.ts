/**
 * Upload policy for property media — the limits, the accepted formats, and the
 * labels for both.
 *
 * ── Why this file is client-safe ────────────────────────────────────────────
 *
 * Same reason as `lib/properties/constants.ts`: the uploader is a Client
 * Component and needs the caps to render "up to 8 MB, JPG/PNG/WebP/AVIF" and to
 * reject a hopeless file before spending the user's upload bandwidth on it. The
 * `MediaKind` *type* comes from `@prisma/client` through a **type-only** import,
 * which TypeScript erases — no Prisma runtime in the browser bundle.
 *
 * ── The client's checks are a courtesy; the server's are the rule ────────────
 *
 * Every constant here is enforced again server-side (`lib/validation/media.ts`
 * for the shape, `lib/media/image.ts` for the bytes) against the actual file
 * content rather than what the browser claimed. Nothing on this list is a
 * security control *because* it appears in a client bundle — the client copy
 * exists so the error arrives instantly and in the right place in the form.
 */
import type { MediaKind } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Accepted image formats
// ─────────────────────────────────────────────────────────────

/**
 * The image allowlist, mapped to the canonical file extension used when building
 * a storage key.
 *
 * ── Why SVG is not on this list ─────────────────────────────────────────────
 *
 * An SVG is a document, not a bitmap. It can carry `<script>`, `<foreignObject>`
 * and external references, and a browser that loads one from this origin will
 * execute all of it — so accepting SVG uploads is accepting stored XSS from any
 * signed-up seller. There is no sanitiser in this project's dependency tree and
 * writing one is not a photo-upload feature. Property photos come out of cameras
 * and phones, which do not produce SVG, so the format is excluded outright
 * rather than "supported, but scrubbed".
 *
 * ── Why GIF and TIFF are not on it ──────────────────────────────────────────
 *
 * Neither is a sensible format for a property photo, and every one of these four
 * has a dimension parser in `lib/media/image.ts`. An allowlist entry with no
 * parser behind it would be an entry that cannot be validated.
 */
export const IMAGE_MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
} as const;

export type ImageMimeType = keyof typeof IMAGE_MIME_EXTENSIONS;

export const IMAGE_MIME_TYPES = Object.keys(IMAGE_MIME_EXTENSIONS) as readonly ImageMimeType[];

export function isImageMimeType(value: string): value is ImageMimeType {
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_EXTENSIONS, value);
}

/** The `accept` attribute for the file input. Explicit MIME types rather than
 *  `image/*`, so the OS picker offers exactly what the server will take. */
export const IMAGE_ACCEPT_ATTRIBUTE = IMAGE_MIME_TYPES.join(",");

/** "JPG, PNG, WebP or AVIF" — for hint text and error messages. */
export const IMAGE_FORMAT_SUMMARY = "JPG, PNG, WebP or AVIF";

// ─────────────────────────────────────────────────────────────
// Size and count limits
// ─────────────────────────────────────────────────────────────

/**
 * Per-file ceiling: 8 MB.
 *
 * Comfortably above a phone photo straight off the camera roll (2–5 MB) and well
 * below anything that would make a request body worth abusing. The whole file is
 * buffered in memory to sniff its header, so this doubles as the bound on that
 * allocation.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling on the *decoded* pixel count: 40 megapixels.
 *
 * A byte-size limit alone does not bound decoding cost — a "decompression bomb"
 * is a few hundred kilobytes of highly compressible pixels that expands to
 * gigabytes of bitmap in whatever tries to resize it. Dimensions are read out of
 * the file header before the bytes are ever decoded, so this check costs nothing
 * and runs first.
 */
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * Floor on each side: 200px.
 *
 * A 1×1 tracking pixel and a 32px favicon are both technically valid JPEGs, and
 * neither is a photograph of a property. Rejecting them at upload is better than
 * rendering one as a cover image.
 */
export const MIN_IMAGE_DIMENSION = 200;

/** How many images one listing may carry. */
export const MAX_IMAGES_PER_PROPERTY = 20;

/** How many files one POST may carry, so a single request stays bounded
 *  regardless of the per-property total still available. */
export const MAX_FILES_PER_UPLOAD = 10;

/**
 * Ceiling on the whole multipart request, checked against `Content-Length`
 * *before* the body is parsed.
 *
 * The per-file limit above cannot do this job on its own: `request.formData()`
 * buffers every part before any of them can be inspected, so a request carrying
 * a hundred 8 MB files would already be resident in memory by the time the first
 * per-file check ran. One coarse check on the declared length is what keeps that
 * from being free. The 512 KB allowance covers multipart boundaries, part headers
 * and the `kind`/`alt` fields.
 */
export const MAX_UPLOAD_REQUEST_BYTES =
  MAX_FILES_PER_UPLOAD * MAX_IMAGE_BYTES + 512 * 1024;

/** Cap on owner-supplied alternative text. Long enough for a real description
 *  of a photo, short enough not to be a free-text dumping ground. */
export const MAX_ALT_LENGTH = 160;

// ─────────────────────────────────────────────────────────────
// Kinds
// ─────────────────────────────────────────────────────────────

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  IMAGE: "Photo",
  FLOOR_PLAN: "Floor plan",
  VIDEO: "Video",
  TOUR_360: "360° tour",
};

/**
 * The kinds this milestone accepts on upload — exactly one.
 *
 * `MediaKind` has four members so that adding a floor plan, a video or a 360°
 * tour later is a new member with a new renderer rather than a second table. But
 * a half-built video pipeline is worse than none, so the boundary refuses
 * everything else: `lib/validation/media.ts` validates against this array, not
 * against the enum.
 */
export const UPLOADABLE_KINDS: readonly MediaKind[] = ["IMAGE"];

export function isUploadableKind(value: string): value is MediaKind {
  return (UPLOADABLE_KINDS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────
// Presentation helpers
// ─────────────────────────────────────────────────────────────

/** "8 MB", "1.4 MB", "812 KB" — for hints and per-file error messages. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;

  const mb = kb / 1024;
  // One decimal below 10 MB, none above: "1.4 MB" is useful, "12.3 MB" is noise.
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/**
 * The public path an image is served from.
 *
 * The ONLY place a media URL is constructed, and it takes the media row's own id
 * — never a storage key, a filename or a directory. That is what keeps the
 * storage layout unpublishable: there is no code path that could put one in an
 * `<img src>`, because this function does not accept one.
 */
export function mediaUrl(mediaId: string): string {
  return `/api/media/${mediaId}`;
}
