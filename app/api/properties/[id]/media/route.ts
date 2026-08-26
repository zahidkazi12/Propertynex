import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireOwnedProperty } from "@/lib/properties/access";
import {
  MAX_FILES_PER_UPLOAD,
  MAX_IMAGES_PER_PROPERTY,
  MAX_UPLOAD_REQUEST_BYTES,
} from "@/lib/media/constants";
import { bytesChecksum, imageRejectionMessage, probeImage } from "@/lib/media/image";
import { buildStorageKey } from "@/lib/media/keys";
import { applyPrimary, applyReorder, diffOrder, nextSortOrder, normalizeOrder } from "@/lib/media/order";
import { toSafeGallery } from "@/lib/media/serialize";
import { getMediaStorage } from "@/lib/media/storage";
import { mediaArrangeSchema, mediaUploadFieldsSchema } from "@/lib/validation/media";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * `/api/properties/[id]/media` — the listing's gallery.
 *
 * ── The shape of the trust boundary ─────────────────────────────────────────
 *
 * Every handler opens with `requireOwnedProperty`, exactly like the rest of
 * `/api/properties/*`. So "unauthorized upload" fails in one of two ways and
 * never reaches a byte of file handling: no session is a 401, and a listing that
 * is not yours is the same 404 a listing that does not exist gives.
 *
 * What the client is trusted with, in total: which files to send, their order,
 * and which one is the cover. Everything else about a stored row is measured or
 * generated server-side —
 *
 *   `mimeType`   from the file's magic bytes (`lib/media/image.ts`)
 *   `width/height` from the format's own header, before any decode
 *   `byteSize`   from the buffer, not from a claimed length
 *   `checksum`   from the bytes
 *   `storageKey` from `randomBytes` (`lib/media/keys.ts`) — never from a filename
 *   `ownerId`    from the property row the guard returned
 *
 * ── Why a partial success is a success ──────────────────────────────────────
 *
 * A seller selecting twelve photos from a phone gallery will sometimes include a
 * screenshot, a HEIC the browser mislabelled, or something 30 MB. Rejecting the
 * whole batch for one bad file means they have to work out which, and start over.
 * So each file is judged on its own: the good ones are stored, and the response
 * names every rejected file with the specific reason. Only a batch in which
 * *nothing* was accepted is an error status.
 */

/** Generous for a real session (a dozen photos per listing, several listings) and
 *  still a bound on scripted abuse. Keyed by user, not by IP: the upload path is
 *  authenticated, so the account is the meaningful subject. */
const UPLOAD_LIMIT = 120;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

type RouteContext = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────────
// GET — the owner's gallery
// ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  try {
    const media = await prisma.propertyMedia.findMany({
      where: { propertyId: guard.property.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    return jsonOk({
      media: toSafeGallery(media),
      limit: MAX_IMAGES_PER_PROPERTY,
      remaining: Math.max(0, MAX_IMAGES_PER_PROPERTY - media.length),
    });
  } catch (error) {
    console.error("[media] list failed:", error);
    return jsonServerError();
  }
}

// ─────────────────────────────────────────────────────────────
// POST — upload
// ─────────────────────────────────────────────────────────────

/** A file part that failed validation, reported back by name. */
type Rejection = { readonly name: string; readonly reason: string };

/**
 * The uploaded filename, only ever echoed back in an error message.
 *
 * It is never used to build a path (see `lib/media/keys.ts`) and never stored, but
 * "photo-3.jpg was too large" is only useful if the seller recognises the name. So
 * it is trimmed to a sane length and stripped of control characters and the
 * directory separators some browsers include, which keeps it safe to put in a JSON
 * string and in the DOM.
 */
function displayName(name: string, index: number): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/[\\/]/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : `File ${index + 1}`;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  const limit = await checkRateLimit(
    "media-upload",
    guard.user.id,
    UPLOAD_LIMIT,
    UPLOAD_WINDOW_MS
  );
  if (!limit.allowed) {
    return jsonError(
      `You've uploaded a lot of photos in a short time. Try again in ${Math.ceil(
        limit.retryAfterMs / 60000
      )} minute(s).`,
      429
    );
  }

  // Checked before `formData()`, which buffers every part: see
  // MAX_UPLOAD_REQUEST_BYTES for why the per-file limit cannot do this job.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_BYTES) {
    return jsonError(
      `That upload is too large. Send at most ${MAX_FILES_PER_UPLOAD} photos at a time.`,
      413
    );
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return jsonError("Photos must be uploaded as a multipart form.", 415);
  }

  const storage = getMediaStorage();
  /** Keys written to storage during this request, for cleanup if the write fails. */
  const writtenKeys: string[] = [];

  try {
    const form = await request.formData();

    const rawKind = form.get("kind");
    const { kind } = mediaUploadFieldsSchema.parse({
      kind: typeof rawKind === "string" ? rawKind : undefined,
    });

    // `files` is the documented field name; `file` is accepted so a single-input
    // form works without a special case.
    const parts = [...form.getAll("files"), ...form.getAll("file")].filter(
      (value): value is File => typeof value === "object" && value !== null && "arrayBuffer" in value
    );

    if (parts.length === 0) {
      return jsonError("Choose at least one photo to upload.", 400);
    }
    if (parts.length > MAX_FILES_PER_UPLOAD) {
      return jsonError(
        `Upload at most ${MAX_FILES_PER_UPLOAD} photos at a time. You selected ${parts.length}.`,
        400
      );
    }

    const existing = await prisma.propertyMedia.findMany({
      where: { propertyId: guard.property.id, kind },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    const room = MAX_IMAGES_PER_PROPERTY - existing.length;
    if (room <= 0) {
      return jsonError(
        `This listing already has the maximum of ${MAX_IMAGES_PER_PROPERTY} photos. Delete one to add another.`,
        400
      );
    }

    const rejected: Rejection[] = [];
    const duplicates: string[] = [];
    // Checksums already on this listing, plus the ones accepted in this batch, so
    // the same file sent twice in one request is also de-duplicated.
    const seenChecksums = new Set(existing.map((row) => row.checksum));

    const pending: {
      readonly storageKey: string;
      readonly mimeType: string;
      readonly byteSize: number;
      readonly width: number;
      readonly height: number;
      readonly checksum: string;
    }[] = [];

    for (const [index, part] of parts.entries()) {
      const name = displayName(part.name, index);

      if (pending.length >= room) {
        rejected.push({
          name,
          reason: `Only ${room} more photo${room === 1 ? "" : "s"} will fit on this listing.`,
        });
        continue;
      }

      const buffer = Buffer.from(await part.arrayBuffer());

      // The one gate. Neither `part.type` nor the filename extension is consulted.
      const probe = probeImage(buffer);
      if (!probe.ok) {
        rejected.push({ name, reason: imageRejectionMessage(probe.reason) });
        continue;
      }

      const checksum = bytesChecksum(buffer);
      if (seenChecksums.has(checksum)) {
        duplicates.push(name);
        continue;
      }
      seenChecksums.add(checksum);

      const storageKey = buildStorageKey(guard.property.id, probe.mimeType);
      await storage.put(storageKey, buffer, probe.mimeType);
      writtenKeys.push(storageKey);

      pending.push({
        storageKey,
        mimeType: probe.mimeType,
        byteSize: probe.byteSize,
        width: probe.width,
        height: probe.height,
        checksum,
      });
    }

    if (pending.length === 0) {
      // Nothing stored. A batch of duplicates is not an error — the listing already
      // has those photos, which is the state the caller wanted.
      if (rejected.length === 0) {
        return jsonOk({
          media: toSafeGallery(existing),
          uploaded: 0,
          duplicates,
          rejected,
        });
      }
      return jsonError(rejected[0].reason, 400, {
        files: rejected.map((item) => `${item.name}: ${item.reason}`).join(" "),
      });
    }

    const base = nextSortOrder(existing);
    const media = await prisma.$transaction(async (tx) => {
      await tx.propertyMedia.createMany({
        data: pending.map((file, index) => ({
          propertyId: guard.property.id,
          // Copied from the row the guard authorised — never from the request.
          ownerId: guard.property.ownerId,
          kind,
          storageDriver: storage.name,
          storageKey: file.storageKey,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          width: file.width,
          height: file.height,
          checksum: file.checksum,
          sortOrder: base + index,
          isPrimary: false,
        })),
      });

      // Re-read and normalise inside the same transaction, so the "exactly one
      // cover, dense positions" invariant holds the moment the rows exist. This is
      // what makes the very first upload the cover without a special case.
      const all = await tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });

      for (const update of diffOrder(all, normalizeOrder(all))) {
        await tx.propertyMedia.update({
          where: { id: update.id },
          data: { sortOrder: update.sortOrder, isPrimary: update.isPrimary },
        });
      }

      return tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
    });

    return jsonOk(
      {
        media: toSafeGallery(media),
        uploaded: pending.length,
        duplicates,
        rejected,
      },
      201
    );
  } catch (error) {
    // Bytes without a row are unreachable — nothing can address them — but they
    // are still wasted space, so a failed write cleans up after itself.
    await Promise.all(
      writtenKeys.map((key) => storage.delete(key).catch(() => {}))
    );

    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    console.error("[media] upload failed:", error);
    return jsonServerError();
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH — reorder and/or choose the cover
// ─────────────────────────────────────────────────────────────

/**
 * One endpoint for both operations because they are one write.
 *
 * A drag-and-drop reorder that also moved a photo into first place would
 * otherwise be two requests that can interleave, and the loser would resurrect the
 * order the winner replaced. Sending `{ order, primaryId }` together makes the
 * whole arrangement a single transaction.
 *
 * Neither field can corrupt the gallery, whatever it contains: `applyReorder`
 * ignores ids that are not in this listing's row set and appends anything the
 * caller omitted, and the result is renumbered. See `lib/media/order.ts`.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  try {
    const input = mediaArrangeSchema.parse(await request.json());

    const rows = await prisma.propertyMedia.findMany({
      where: { propertyId: guard.property.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    if (rows.length === 0) {
      return jsonError("This listing has no photos to arrange.", 400);
    }

    let arrangement = input.order ? applyReorder(rows, input.order) : normalizeOrder(rows);

    if (input.primaryId) {
      const withCover = applyPrimary(arrangement, input.primaryId);
      // Null means the id is not one of this listing's photos — which is also what
      // another owner's media id produces, since it was never in `rows`.
      if (!withCover) return jsonError("That photo could not be found.", 404);
      arrangement = withCover;
    }

    const updates = diffOrder(rows, arrangement);

    const media = await prisma.$transaction(async (tx) => {
      for (const update of updates) {
        // Constrained on propertyId as well as id, for the same reason the property
        // routes constrain their writes on ownerId after the guard has passed.
        await tx.propertyMedia.updateMany({
          where: { id: update.id, propertyId: guard.property.id },
          data: { sortOrder: update.sortOrder, isPrimary: update.isPrimary },
        });
      }

      return tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
    });

    return jsonOk({ media: toSafeGallery(media), changed: updates.length });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("That arrangement isn't valid.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[media] arrange failed:", error);
    return jsonServerError();
  }
}
