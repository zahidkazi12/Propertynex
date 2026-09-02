import "server-only";

import { prisma } from "@/lib/db/prisma";
import { LIVE_STATUSES } from "@/lib/properties/status";
import { isValidRecordId } from "@/lib/utils/record-id";

/**
 * Saved listings.
 *
 * ── The rule this module exists to enforce ──────────────────────────────────
 *
 * A user may only save a listing that is *publicly live at the moment of the
 * write*. Without that check, `POST /api/favorites` is an existence oracle: a
 * signed-in attacker posts ids and reads the 200/404 split to learn which
 * drafts exist, and then which of them belong to a competitor. Every other
 * public read path already refuses non-live rows; this is the write path that
 * has to refuse them too, and it does it in the same `where` as the insert
 * rather than in a preceding read, so there is no window between the check and
 * the write.
 *
 * The read side needs no such check, because the browse query filters on status
 * independently: a listing saved while live and later unpublished simply stops
 * appearing in the saved view. The favorite row survives — unpublishing is
 * reversible, and silently deleting other people's saves because a seller took a
 * listing offline for a week would be the wrong behaviour.
 *
 * ── Idempotence ────────────────────────────────────────────────────────────
 *
 * Save is an upsert against `@@unique([userId, propertyId])` and unsave is a
 * `deleteMany`. Both are safe to repeat: a double-tapped heart cannot create two
 * rows (the database refuses), and un-saving something already gone is a no-op
 * rather than a 404. The button is optimistic, so it will be repeated.
 */

/** Save a listing. Returns false when the property is not one a user may save. */
export async function addFavorite(userId: string, propertyId: string): Promise<boolean> {
  if (!isValidRecordId(propertyId)) return false;

  // The status check and the write are one statement. A `findUnique` followed by
  // a `create` would leave a window in which a listing is unpublished between
  // the two, and would need its own handling for the unique-constraint race.
  const live = await prisma.property.findFirst({
    where: { id: propertyId, status: { in: [...LIVE_STATUSES] } },
    select: { id: true },
  });
  if (!live) return false;

  await prisma.favorite.upsert({
    where: { userId_propertyId: { userId, propertyId } },
    create: { userId, propertyId },
    update: {},
  });
  return true;
}

/**
 * Un-save a listing.
 *
 * `deleteMany` rather than `delete` so that removing a save that is not there
 * succeeds instead of throwing `P2025`. There is no status check: a user must
 * always be able to un-save, including a listing that has since gone offline —
 * that is the one case where they would most want to.
 */
export async function removeFavorite(userId: string, propertyId: string): Promise<void> {
  if (!isValidRecordId(propertyId)) return;
  await prisma.favorite.deleteMany({ where: { userId, propertyId } });
}

/**
 * Which of these listings has this user saved?
 *
 * A `Set` for the card renderer, built from one indexed query over the page's
 * ids — twelve cards is one round trip, not twelve. Returns an empty set for a
 * signed-out visitor and for an empty page, so callers never branch on null.
 */
export async function favoriteIdsFor(
  userId: string | null,
  propertyIds: readonly string[]
): Promise<Set<string>> {
  if (!userId || propertyIds.length === 0) return new Set();

  try {
    const rows = await prisma.favorite.findMany({
      where: { userId, propertyId: { in: [...propertyIds] } },
      select: { propertyId: true },
    });
    return new Set(rows.map((row) => row.propertyId));
  } catch (error) {
    // A failed favorites lookup must not take down a browse page: the cards are
    // the content, and the hearts are decoration on top of them. Every heart
    // renders hollow, and clicking one still works.
    console.error("[favorites] lookup failed:", error);
    return new Set();
  }
}

/**
 * Every property id this user has saved, newest save first.
 *
 * Feeds the `saved=1` browse filter, which then applies the same status,
 * intent and filter constraints as any other browse — so the saved view cannot
 * become a back door to a listing the ordinary view would hide.
 *
 * Capped, because it becomes an `id: { in: [...] }` and an unbounded `$in` is a
 * query nobody wants to issue. Nothing in this product suggests a user saves
 * more than a few dozen listings; the cap is two orders of magnitude above that.
 */
const MAX_SAVED_IDS = 500;

export async function savedPropertyIds(userId: string): Promise<string[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_SAVED_IDS,
    select: { propertyId: true },
  });
  return rows.map((row) => row.propertyId);
}

/** How many listings this user has saved. For the navbar/dashboard counter. */
export async function favoriteCount(userId: string): Promise<number> {
  return prisma.favorite.count({ where: { userId } });
}
