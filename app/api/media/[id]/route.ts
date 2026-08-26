import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isImageMimeType } from "@/lib/media/constants";
import { findServableMedia } from "@/lib/media/read";
import { getMediaStorage } from "@/lib/media/storage";

/**
 * `/api/media/[id]` — the only address a stored file ever has.
 *
 * ── Why bytes go through a route handler at all ─────────────────────────────
 *
 * The obvious alternative is writing uploads into `public/` and letting the
 * static handler serve them. That was rejected, for reasons `lib/media/storage/local.ts`
 * sets out: the static handler runs no access check, so a DRAFT listing's photos
 * would be world-readable the moment they were uploaded, and the URL would publish
 * the storage layout. Going through a handler costs a database read per image and
 * buys three things —
 *
 *   1. the access rule in `lib/media/read.ts` runs on every request;
 *   2. the URL is `/api/media/<id>` and nothing else, so no internal path is
 *      exposed (the seller's filename is not even stored — `lib/media/keys.ts`);
 *   3. the `Content-Type` sent back is the one derived from the file's own magic
 *      bytes at upload time, not anything a client ever asserted.
 *
 * ── Safe rendering ─────────────────────────────────────────────────────────
 *
 * Point 3 is the substance of it, and the headers below are the rest. A file is
 * only stored if `probeImage` recognised it as JPEG/PNG/WebP/AVIF from its bytes,
 * SVG is not in that allowlist at all (it is a script-bearing document, not a
 * photo), and the stored MIME type is re-checked here before being echoed — so a
 * row whose `mimeType` was somehow corrupted downgrades to
 * `application/octet-stream` rather than inviting the browser to interpret it.
 * `nosniff` stops the browser second-guessing that, `Content-Disposition: inline`
 * with no filename gives it nothing to name a download after, and the CSP is the
 * belt-and-braces case: if something that is not an image ever did get served from
 * here, `default-src 'none'; sandbox` means it executes nothing and reaches
 * nowhere.
 */

type RouteContext = { params: Promise<{ id: string }> };

/**
 * How long a *public* photo may sit in a shared cache.
 *
 * Short on purpose. These bytes are immutable — a photo is never rewritten in
 * place, only added or deleted — so a long `immutable` cache would be the obvious
 * choice. But visibility is not immutable: unpublishing a listing must take its
 * photos offline, and anything a CDN or proxy already holds keeps serving until it
 * expires. Sixty seconds bounds that window to something a seller would describe
 * as "immediately" while still absorbing the burst of requests a browse page makes.
 */
const PUBLIC_CACHE_SECONDS = 60;

export async function GET(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  try {
    // May be null. An anonymous visitor must be able to load a live listing's
    // photos, and so must the `next/image` optimizer, which fetches server-side
    // and sends no cookies.
    const viewer = await getCurrentUser();

    const found = await findServableMedia(id, viewer);
    // One 404 for every failure: no such id, a malformed id, someone else's draft.
    if (!found) return notFound();

    const { media, isPublic } = found;

    const bytes = await getMediaStorage().get(media.storageKey);
    // A row whose bytes have gone. Reported as a missing image rather than a 500 —
    // from the caller's side that is exactly what it is — but logged, because it
    // means storage and the database have drifted apart.
    if (!bytes) {
      console.error("[media] stored object missing for media", media.id);
      return notFound();
    }

    // The row's MIME type is re-validated rather than trusted, so the only values
    // this route can ever put in a Content-Type header are the four in the allowlist.
    const contentType = isImageMimeType(media.mimeType)
      ? media.mimeType
      : "application/octet-stream";

    // The checksum is already a hash of exactly these bytes, so it is the ETag —
    // no separate version field to keep in step. Quoted and marked strong, which is
    // accurate: same ETag means byte-identical.
    const etag = `"${media.checksum}"`;

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      // No `filename=`: there is no client-supplied name to leak or to sanitise.
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": isPublic
        ? `public, max-age=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=${PUBLIC_CACHE_SECONDS}`
        : "private, no-store",
    });

    // An owner-only photo must never be stored by a shared cache, and `Vary` says
    // the response depended on who asked — belt and braces with `private, no-store`.
    if (!isPublic) headers.set("Vary", "Cookie");

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    // Copied into a `Uint8Array` for one unglamorous reason: the DOM `BodyInit` type
    // this project compiles against does not accept `Buffer<ArrayBufferLike>`, and a
    // cast to force it through would be a lie about types to save a memcpy. The
    // copy is bounded by MAX_IMAGE_BYTES, so worst case is a few megabytes held
    // twice for the length of one response. Streaming instead would be the real fix
    // and belongs with a remote storage driver, not with reading a local file.
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    console.error("[media] serve failed:", error);
    // Deliberately the same 404 shape, with no body: a media URL is used as an
    // `<img src>`, and an error page rendered into an image slot helps nobody.
    return new Response(null, { status: 500 });
  }
}

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
