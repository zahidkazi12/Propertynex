import "server-only";

/**
 * The Vercel Blob driver — the production counterpart to `local.ts`.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `local.ts` writes to a directory beside the project. That is correct for a
 * single-instance deployment and structurally impossible on Vercel: a serverless
 * function's filesystem is read-only apart from `/tmp`, so the first upload fails
 * with `ENOENT: mkdir '/var/task/.media-storage'`, and anything that *did* land in
 * `/tmp` would be invisible to the next invocation and gone on the next deploy.
 * The seam `types.ts` describes was added for exactly this swap, so this is an
 * implementation of three methods and one case in `resolveDriver()` — no route,
 * no component, no column, and no change to how a photo is addressed.
 *
 * ── Why the store is private ────────────────────────────────────────────────
 *
 * A public blob is served straight off the CDN by its URL, with no application
 * code in the path. That is the same objection `local.ts` raises against writing
 * into `public/`: a DRAFT listing's photos would be readable by anyone holding the
 * URL, which contradicts what `lib/media/read.ts` promises about unpublished
 * listings. So bytes are stored privately and still reach a browser only through
 * `/api/media/[id]`, which loads the row, applies the access rule, and streams the
 * result. Nothing a visitor sees changes; the storage layout stays unpublished.
 *
 * `MEDIA_BLOB_ACCESS` exists only because a store's access mode is chosen when the
 * store is created and cannot be changed afterwards — a deployment that already
 * has a public store needs a way to say so. It defaults to `private`, which is the
 * mode that preserves the draft-privacy contract.
 *
 * ── The key is the pathname ─────────────────────────────────────────────────
 *
 * `lib/media/keys.ts` already produces an opaque, server-generated, 128-bit-random
 * key with no client input anywhere in it, and slashes in a blob pathname are
 * folder delimiters — so the key is used verbatim as the pathname. That keeps
 * `PropertyMedia.storageKey` meaning the same thing under both drivers, which is
 * what lets existing rows keep working untouched.
 *
 * `addRandomSuffix: false` is load-bearing rather than a preference: a suffix would
 * make the stored pathname differ from the key in the database, and every
 * subsequent read of that row would find nothing. `isSafeStorageKey` runs on every
 * call here for the same reason it does in the local driver — a tampered or
 * corrupted `storageKey` column must not become an arbitrary object fetch.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * Never passed explicitly and never read into a variable here. The SDK resolves
 * them from the environment itself — OIDC (`BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`,
 * which Vercel adds and rotates when a store is connected to the project) first,
 * then the static `BLOB_READ_WRITE_TOKEN`. This module only checks that *some*
 * credential is present, so a misconfigured deployment fails on the first upload
 * with a sentence naming the variable, rather than with an SDK error about
 * authentication.
 */
import { BlobNotFoundError, del, get, put } from "@vercel/blob";
import { MAX_IMAGE_BYTES } from "@/lib/media/constants";
import { isSafeStorageKey } from "@/lib/media/keys";
import type { MediaStorage } from "@/lib/media/storage/types";

/** Persisted to `PropertyMedia.storageDriver`, and the name `MEDIA_STORAGE_DRIVER`
 *  selects. */
export const VERCEL_BLOB_DRIVER = "vercel-blob";

type BlobAccess = "private" | "public";

const DEFAULT_ACCESS: BlobAccess = "private";

/**
 * Access mode for written objects, which must match the mode of the connected
 * store.
 *
 * Fail-closed on an unrecognised value, the same posture `resolveDriver()` takes:
 * silently downgrading `MEDIA_BLOB_ACCESS=Private` (or a typo) to public would put
 * unpublished listings' photos on a CDN URL, which is precisely the outcome this
 * driver is arranged to prevent.
 */
export function resolveBlobAccess(): BlobAccess {
  const configured = process.env.MEDIA_BLOB_ACCESS?.trim().toLowerCase();
  if (!configured || configured.length === 0) return DEFAULT_ACCESS;

  if (configured === "private" || configured === "public") return configured;

  throw new Error(
    `MEDIA_BLOB_ACCESS="${configured}" is not a valid Vercel Blob access mode ` +
      `(expected one of: private, public).`
  );
}

/**
 * True when the SDK will find a credential.
 *
 * Presence only — no value is read, logged, or returned. OIDC needs both the store
 * id and the token, so a half-configured OIDC setup does not count as configured.
 */
function hasBlobCredentials(): boolean {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token && token.length > 0) return true;

  const storeId = process.env.BLOB_STORE_ID?.trim();
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  return Boolean(storeId && storeId.length > 0 && oidcToken && oidcToken.length > 0);
}

function isNotFound(error: unknown): boolean {
  return error instanceof BlobNotFoundError;
}

/**
 * Collect the response stream into a `Buffer`.
 *
 * Capped at `MAX_IMAGE_BYTES`, the same ceiling the upload path enforces. Every
 * object in the store was written through that path, so the cap should never
 * trigger — it is there so that a store entry which somehow is not one of ours
 * cannot make a single request allocate without bound.
 */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        throw new Error("vercel-blob storage: stored object exceeds the upload size limit");
      }
      chunks.push(value);
    }
  } finally {
    // Releases the underlying connection on the throw path as well as the normal
    // one, so an oversized or aborted read does not leak a socket per request.
    reader.releaseLock();
    await stream.cancel().catch(() => {});
  }

  return Buffer.concat(chunks);
}

export function createVercelBlobMediaStorage(): MediaStorage {
  if (!hasBlobCredentials()) {
    throw new Error(
      'MEDIA_STORAGE_DRIVER="vercel-blob" needs a Blob credential. Connect a Vercel ' +
        "Blob store to this project (which provides BLOB_STORE_ID and VERCEL_OIDC_TOKEN " +
        "automatically), or set BLOB_READ_WRITE_TOKEN."
    );
  }

  const access = resolveBlobAccess();

  return {
    name: VERCEL_BLOB_DRIVER,

    async put(key, bytes, contentType) {
      if (!isSafeStorageKey(key)) {
        throw new Error("vercel-blob storage: refusing to write an unsafe key");
      }

      await put(key, bytes, {
        access,
        // The key IS the pathname. A suffix would make the stored object's
        // pathname disagree with `PropertyMedia.storageKey` and every read of
        // that row would miss.
        addRandomSuffix: false,
        // Metadata only. `/api/media/[id]` sends `PropertyMedia.mimeType`, which
        // it re-validates against the allowlist first, so nothing downstream
        // depends on what the store thinks a file is.
        contentType,
      });
    },

    async get(key) {
      // An unsafe key is "nothing there" rather than an error, matching the local
      // driver: the caller turns null into a 404, and a malformed key genuinely
      // does not identify an object.
      if (!isSafeStorageKey(key)) return null;

      try {
        const result = await get(key, { access });
        // `null` is not-found; a 304 cannot happen because no `ifNoneMatch` is
        // sent, but the union admits it and a null stream is not bytes.
        if (!result || result.stream === null) return null;

        return await collect(result.stream);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      if (!isSafeStorageKey(key)) return;

      // `del` is idempotent — an absent pathname is a success — so a retried
      // delete after a partly failed request is not an error, which is what the
      // interface promises. There are no directories to prune.
      try {
        await del(key);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },
  };
}
