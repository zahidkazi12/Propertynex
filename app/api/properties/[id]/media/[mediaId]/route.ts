import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnedProperty } from "@/lib/properties/access";
import { isValidRecordId } from "@/lib/utils/record-id";
import { applyPrimary, diffOrder, normalizeOrder } from "@/lib/media/order";
import { toSafeGallery } from "@/lib/media/serialize";
import { getMediaStorage } from "@/lib/media/storage";
import { mediaUpdateSchema } from "@/lib/validation/media";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * `/api/properties/[id]/media/[mediaId]` — one photo.
 *
 * ── Two ids, one check ──────────────────────────────────────────────────────
 *
 * The listing id is authorised by `requireOwnedProperty`; the media id is then
 * only ever looked up *within that listing* (`where: { id, propertyId }`). So a
 * caller who owns listing A and knows a media id from listing B gets the same 404
 * an invented id gets — the row is simply not in the set being searched, and there
 * is no second code path where the media id is trusted on its own.
 *
 * That is also why neither handler re-derives ownership from `PropertyMedia.ownerId`.
 * That column exists for reporting and for a future "all my photos" query; the
 * authorization decision stays where the rest of the app makes it, on the parent
 * listing. One rule, one place to change it.
 */

const NOT_FOUND_MESSAGE = "That photo could not be found.";

type RouteContext = { params: Promise<{ id: string; mediaId: string }> };

// ─────────────────────────────────────────────────────────────
// PATCH — alt text, or promote to cover
// ─────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id, mediaId } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  // Before Prisma sees it — an id the database could not have issued is a 404.
  if (!isValidRecordId(mediaId)) return jsonError(NOT_FOUND_MESSAGE, 404);

  try {
    const input = mediaUpdateSchema.parse(await request.json());

    const target = await prisma.propertyMedia.findFirst({
      where: { id: mediaId, propertyId: guard.property.id },
    });
    if (!target) return jsonError(NOT_FOUND_MESSAGE, 404);

    // Alt text alone touches one row and cannot disturb the gallery's invariants,
    // so it does not need the transaction the cover change does.
    //
    // It still answers with the whole gallery. Returning just the one changed row
    // would make `media` mean "a photo" here and "the photos" in every other media
    // response, and a client that has to branch on the shape of a field is a client
    // that will eventually branch wrongly. One extra read buys one response contract.
    if (input.isPrimary !== true) {
      await prisma.propertyMedia.update({
        where: { id: target.id },
        data: { alt: input.alt ?? null },
      });

      const media = await prisma.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      return jsonOk({ media: toSafeGallery(media) });
    }

    const media = await prisma.$transaction(async (tx) => {
      const rows = await tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });

      // `applyPrimary` returns the whole arrangement with the flag moved, so the
      // "exactly one cover" invariant is restored in the same write that breaks it —
      // there is no instant at which two rows are flagged.
      const arrangement = applyPrimary(normalizeOrder(rows), target.id);
      if (arrangement) {
        for (const update of diffOrder(rows, arrangement)) {
          await tx.propertyMedia.updateMany({
            where: { id: update.id, propertyId: guard.property.id },
            data: { sortOrder: update.sortOrder, isPrimary: update.isPrimary },
          });
        }
      }

      if (input.alt !== undefined) {
        await tx.propertyMedia.updateMany({
          where: { id: target.id, propertyId: guard.property.id },
          data: { alt: input.alt },
        });
      }

      return tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
    });

    return jsonOk({ media: toSafeGallery(media) });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[media] update failed:", error);
    return jsonServerError();
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────

/**
 * Remove a photo.
 *
 * ── Row first, bytes second ─────────────────────────────────────────────────
 *
 * The order matters, and it is the opposite of what feels natural. The row is
 * deleted (and the gallery renumbered) in a transaction; only then are the bytes
 * removed from storage.
 *
 * If the byte delete fails, the outcome is an orphaned file: invisible, because
 * nothing can address it — `/api/media/[id]` resolves through the database, so a
 * key with no row is unreachable by construction. Wasted disk, no more.
 *
 * The reverse order fails much worse. Deleting bytes first and then losing the
 * transaction leaves a row that every gallery still renders, pointing at a file
 * that is gone — a permanently broken image in a live listing that only a manual
 * database edit can clear.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id, mediaId } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  if (!isValidRecordId(mediaId)) return jsonError(NOT_FOUND_MESSAGE, 404);

  try {
    const target = await prisma.propertyMedia.findFirst({
      where: { id: mediaId, propertyId: guard.property.id },
    });
    if (!target) return jsonError(NOT_FOUND_MESSAGE, 404);

    const media = await prisma.$transaction(async (tx) => {
      const removed = await tx.propertyMedia.deleteMany({
        where: { id: target.id, propertyId: guard.property.id },
      });
      // Someone else deleted it between the read and here. Nothing to renumber and
      // nothing to unlink — treat the request as already satisfied.
      if (removed.count === 0) {
        return tx.propertyMedia.findMany({
          where: { propertyId: guard.property.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
      }

      const rows = await tx.propertyMedia.findMany({
        where: { propertyId: guard.property.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });

      // Deleting the cover, or anything but the last photo, leaves a gap and
      // possibly no primary at all. `normalizeOrder` closes both: positions become
      // dense again and the new first photo inherits the cover if the old one left.
      for (const update of diffOrder(rows, normalizeOrder(rows))) {
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

    // Best effort, deliberately after the commit and deliberately not fatal.
    try {
      await getMediaStorage().delete(target.storageKey);
    } catch (error) {
      console.error("[media] orphaned stored object after delete:", error);
    }

    return jsonOk({ media: toSafeGallery(media), deleted: target.id });
  } catch (error) {
    console.error("[media] delete failed:", error);
    return jsonServerError();
  }
}
