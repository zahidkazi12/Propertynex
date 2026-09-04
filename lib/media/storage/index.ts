import "server-only";

/**
 * Driver resolution.
 *
 * Mirrors `lib/otp/providers/index.ts`: one environment variable names the
 * driver, the resolution is memoised, an unknown name is a hard error rather than
 * a silent fallback, and a test can swap the whole thing out.
 *
 * ── Why an unknown driver name throws ───────────────────────────────────────
 *
 * Falling back to the local disk when `MEDIA_STORAGE_DRIVER=s3` is misspelled
 * would mean a deployment that believes it is writing to a bucket is quietly
 * writing to a container filesystem that vanishes on the next deploy. The photos
 * would appear to upload and then disappear, days later, with no error anywhere.
 * Failing at the first upload instead is the kinder outcome by a wide margin —
 * the same fail-closed posture the OTP providers take.
 *
 * ── Why the default depends on where the code is running ────────────────────
 *
 * `local` was the default everywhere, and on Vercel that is not a slow-burning
 * problem but an immediate one: a serverless function's filesystem is read-only
 * outside `/tmp`, so the first upload died with
 * `ENOENT: mkdir '/var/task/.media-storage'`. There is no value of
 * `MEDIA_STORAGE_DIR` that fixes it, because the fault is the filesystem, not the
 * path — and a writable `/tmp` would be worse, since the bytes would be invisible
 * to the next invocation and gone on the next deploy.
 *
 * So the default is per-environment: `vercel-blob` when `VERCEL` is set,
 * `local` otherwise. An explicit `MEDIA_STORAGE_DRIVER` still wins, with one
 * exception — `local` on Vercel is refused rather than obeyed, because it cannot
 * work there and the failure it produces otherwise is a stack trace about `mkdir`
 * rather than a sentence about configuration.
 */
import { createLocalMediaStorage } from "@/lib/media/storage/local";
import type { MediaStorage } from "@/lib/media/storage/types";
import { createVercelBlobMediaStorage } from "@/lib/media/storage/vercel-blob";

export type { MediaStorage } from "@/lib/media/storage/types";

/** The driver names this build knows. Adding "s3" here and a file beside
 *  `local.ts` is the whole of a migration to another object store. */
export const MEDIA_STORAGE_DRIVERS = ["local", "vercel-blob"] as const;
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];

let cached: MediaStorage | null = null;
let override: MediaStorage | null = null;

/** True inside a Vercel build or function. Vercel sets `VERCEL=1` in every
 *  environment it runs, including preview and development deployments. */
function onVercel(): boolean {
  const flag = process.env.VERCEL?.trim();
  return flag === "1" || flag === "true";
}

export function resolveDriver(): MediaStorageDriver {
  const configured = process.env.MEDIA_STORAGE_DRIVER?.trim().toLowerCase();

  if (!configured || configured.length === 0) {
    return onVercel() ? "vercel-blob" : "local";
  }

  if (!(MEDIA_STORAGE_DRIVERS as readonly string[]).includes(configured)) {
    throw new Error(
      `MEDIA_STORAGE_DRIVER="${configured}" is not a known media storage driver ` +
        `(expected one of: ${MEDIA_STORAGE_DRIVERS.join(", ")}).`
    );
  }

  if (configured === "local" && onVercel()) {
    throw new Error(
      'MEDIA_STORAGE_DRIVER="local" cannot work on Vercel: a function\'s filesystem is ' +
        "read-only outside /tmp, and /tmp is not shared between invocations or kept across " +
        'deploys. Use "vercel-blob" (the default on Vercel) with a connected Blob store.'
    );
  }

  return configured as MediaStorageDriver;
}

/** The installed driver. Memoised, because a driver resolves its configuration
 *  from the environment once and there is no reason to redo that per request.
 *  Failures are deliberately *not* cached: a deployment that adds the missing
 *  variable and restarts gets a working driver. */
export function getMediaStorage(): MediaStorage {
  if (override) return override;
  if (cached) return cached;

  const driver = resolveDriver();
  switch (driver) {
    case "local":
      cached = createLocalMediaStorage();
      break;
    case "vercel-blob":
      cached = createVercelBlobMediaStorage();
      break;
  }

  return cached!;
}

/** Test seam, matching `setRateLimitStore`. Lets a test capture writes in memory
 *  instead of touching a disk. */
export function setMediaStorage(storage: MediaStorage): void {
  override = storage;
}

export function resetMediaStorage(): void {
  override = null;
  cached = null;
}

/** For diagnostics — which driver a row's bytes would be written through. Never
 *  exposed to a client. */
export function getMediaStorageName(): string {
  return getMediaStorage().name;
}
