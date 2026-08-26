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
 */
import { createLocalMediaStorage } from "@/lib/media/storage/local";
import type { MediaStorage } from "@/lib/media/storage/types";

export type { MediaStorage } from "@/lib/media/storage/types";

/** The driver names this build knows. Adding "s3" here and a file beside
 *  `local.ts` is the whole of a migration to object storage. */
export const MEDIA_STORAGE_DRIVERS = ["local"] as const;
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];

let cached: MediaStorage | null = null;
let override: MediaStorage | null = null;

function resolveDriver(): MediaStorageDriver {
  const configured = process.env.MEDIA_STORAGE_DRIVER?.trim().toLowerCase();
  if (!configured || configured.length === 0) return "local";

  if ((MEDIA_STORAGE_DRIVERS as readonly string[]).includes(configured)) {
    return configured as MediaStorageDriver;
  }

  throw new Error(
    `MEDIA_STORAGE_DRIVER="${configured}" is not a known media storage driver ` +
      `(expected one of: ${MEDIA_STORAGE_DRIVERS.join(", ")}).`
  );
}

/** The installed driver. Memoised, because the local driver resolves its root
 *  from the environment once and there is no reason to redo that per request. */
export function getMediaStorage(): MediaStorage {
  if (override) return override;
  if (cached) return cached;

  const driver = resolveDriver();
  switch (driver) {
    case "local":
      cached = createLocalMediaStorage();
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
