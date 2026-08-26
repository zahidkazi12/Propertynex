import "server-only";

/**
 * The local-filesystem driver — the default, and the only one implemented.
 *
 * ── Why the storage root is not inside `public/` ─────────────────────────────
 *
 * Putting uploads in `public/uploads/` is the shortest path to a working image,
 * and it is wrong here for three independent reasons:
 *
 *   1. Everything under `public/` is served by the static handler, before any
 *      application code runs. A DRAFT listing's photos would be world-readable
 *      the moment they were uploaded, which contradicts what `/sell` promises
 *      about drafts and what `PropertyStatus` means.
 *   2. The URL would *be* the storage path, publishing the directory layout and
 *      making keys enumerable — the thing `prisma/schema.prisma` explains at
 *      length that this design avoids.
 *   3. `next build` snapshots `public/`. Files written at runtime are not part of
 *      the build output, so the mental model "it's in public, it's served" quietly
 *      stops holding in a container.
 *
 * So the root is a sibling directory, git-ignored, and unreachable except through
 * `/api/media/[id]`, which loads the row and checks access first.
 *
 * ── Why every path is rebuilt rather than trusted ───────────────────────────
 *
 * `isSafeStorageKey` runs on every call, including reads and deletes whose key
 * came out of the database. A key is then split on `/` and re-joined with the
 * platform separator, and the result is checked to still be inside the root. Two
 * independent guards for one property: no request, and no database value, can
 * address a file outside the storage root.
 */
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeStorageKey, storageKeyPropertyId } from "@/lib/media/keys";
import type { MediaStorage } from "@/lib/media/storage/types";

/** Default root, relative to the working directory. Dot-prefixed so it sorts out
 *  of the way, and git-ignored. */
const DEFAULT_STORAGE_DIR = ".media-storage";

export function localStorageRoot(): string {
  const configured = process.env.MEDIA_STORAGE_DIR?.trim();
  return path.resolve(process.cwd(), configured && configured.length > 0 ? configured : DEFAULT_STORAGE_DIR);
}

/**
 * Key → absolute path, or null if the key is not exactly the shape
 * `lib/media/keys.ts` produces.
 *
 * Exported for `tests/unit/media-storage-key.test.ts`, which is the natural place
 * to pin traversal behaviour — the assertion worth making is that
 * `properties/../../etc/passwd` and its encoded cousins resolve to null, and that
 * is a pure-function property.
 */
export function resolveStoragePath(root: string, key: string): string | null {
  if (!isSafeStorageKey(key)) return null;

  const resolved = path.resolve(root, ...key.split("/"));

  // Belt and braces. The pattern check above already makes traversal
  // unrepresentable; this catches a future loosening of it.
  const boundary = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(boundary)) return null;

  return resolved;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export function createLocalMediaStorage(root: string = localStorageRoot()): MediaStorage {
  return {
    name: "local",

    async put(key, bytes) {
      const target = resolveStoragePath(root, key);
      if (!target) throw new Error("local storage: refusing to write an unsafe key");

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },

    async get(key) {
      const target = resolveStoragePath(root, key);
      // An unsafe key is treated as "nothing there" rather than an error: the
      // caller turns null into a 404, and a malformed key genuinely does not
      // identify a file.
      if (!target) return null;

      try {
        return await readFile(target);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      const target = resolveStoragePath(root, key);
      if (!target) return;

      // `force` makes an already-absent file a success, so a retried delete after
      // a partially failed request is not an error.
      await rm(target, { force: true });

      // Prune the listing's directory once its last photo is gone. Best-effort:
      // ENOTEMPTY simply means another photo is still there.
      const propertyId = storageKeyPropertyId(key);
      if (propertyId) {
        await rmdir(path.dirname(target)).catch(() => {});
      }
    },
  };
}
