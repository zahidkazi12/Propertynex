import "server-only";

/**
 * Media reads.
 *
 * ── The access rule for serving bytes ───────────────────────────────────────
 *
 * `/api/media/[id]` is the only way a photo reaches a browser, and it is
 * deliberately *not* behind `middleware.ts` — a live listing's photos must load
 * for anonymous visitors on `/buy` and `/rent`, and for the `next/image`
 * optimizer, which fetches server-side and sends no cookies. So the decision is
 * made here, per row:
 *
 *   - the parent listing is live (`isLive`)  → anyone may fetch it.
 *   - otherwise                             → only the owner, or an admin.
 *
 * That is the same privacy contract the listing itself has. A DRAFT's photos are
 * exactly as private as the DRAFT, so uploading before publishing does not
 * quietly put pictures of someone's home on a public URL. Unpublishing takes the
 * photos offline with the listing, and republishing brings them back — no
 * separate media-visibility state to fall out of step.
 *
 * Every failure is the same 404. A media id that never existed, one whose bytes
 * have gone, and one belonging to a stranger's draft are indistinguishable from
 * outside — the existence-oracle argument in `lib/properties/ownership.ts`
 * applies unchanged, and it applies harder here, because a media id would
 * otherwise confirm the existence of an *unpublished* listing.
 */
import type { PropertyMedia } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  isAdminRole,
  type PropertyActor,
} from "@/lib/properties/ownership";
import { isLive } from "@/lib/properties/status";
import { isValidRecordId } from "@/lib/utils/record-id";

/** A listing's media, in the seller's order. `kind` is filtered by the caller —
 *  the photo manager wants images, and there is nothing else to want yet. */
export async function listPropertyMedia(propertyId: string): Promise<PropertyMedia[]> {
  return prisma.propertyMedia.findMany({
    where: { propertyId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function listPropertyImages(propertyId: string): Promise<PropertyMedia[]> {
  return prisma.propertyMedia.findMany({
    where: { propertyId, kind: "IMAGE" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function countPropertyImages(propertyId: string): Promise<number> {
  return prisma.propertyMedia.count({ where: { propertyId, kind: "IMAGE" } });
}

/**
 * The outcome of a servable-media lookup.
 *
 * `isPublic` is the one thing about the parent listing that travels with the row,
 * and it is a single derived bit rather than the listing itself. The serving route
 * needs it for cache policy: a live listing's photo may sit in a shared cache for a
 * short while, an owner-only one must never be stored by any cache at all. Deriving
 * it here keeps `isLive` and the visibility rule in the same place, so the two
 * cannot drift; returning the `Property` instead would hand the route a row it has
 * no business serialising.
 */
export type ServableMedia = {
  readonly media: PropertyMedia;
  readonly isPublic: boolean;
};

/**
 * Resolve a media id for serving, applying the rule above.
 *
 * `actor` is null for an anonymous request. Returns the row — never the parent
 * listing, so a caller cannot accidentally serialise a property it was only shown
 * for an access check.
 */
export async function findServableMedia(
  rawMediaId: string,
  actor: PropertyActor | null
): Promise<ServableMedia | null> {
  // The shape is checked before the query, so `/api/media/../../etc/passwd` is a
  // 404 rather than a pointless round trip — see `lib/utils/record-id.ts`.
  if (!isValidRecordId(rawMediaId)) return null;

  const found = await prisma.propertyMedia.findUnique({
    where: { id: rawMediaId },
    include: { property: { select: { ownerId: true, status: true } } },
  });
  if (!found) return null;

  // Destructured so the joined listing is separated from the row before either is
  // used: `media` is what the caller gets, and it structurally cannot carry the
  // owner id the check consulted.
  const { property, ...media } = found;

  const isPublic = isLive(property.status);
  const visible =
    isPublic || (actor !== null && (property.ownerId === actor.id || isAdminRole(actor.role)));

  return visible ? { media, isPublic } : null;
}
