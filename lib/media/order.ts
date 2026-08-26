/**
 * Gallery order and cover selection — the pure part.
 *
 * ── Why this is a separate module with no imports ───────────────────────────
 *
 * Reordering and choosing a cover photo are the two operations in this feature
 * with real invariants: positions must stay dense, exactly one photo must be the
 * cover, and a client that sends a partial, duplicated, reordered or foreign list
 * of ids must not be able to corrupt either property. Those are exactly the rules
 * worth testing directly, and they are testable only if deciding them is separate
 * from writing them.
 *
 * So nothing here touches Prisma, `server-only`, or a request. Every function
 * takes rows in and returns rows out. `app/api/properties/[id]/media/route.ts`
 * loads, calls, diffs, and writes the diff in one transaction;
 * `tests/unit/media-order.test.ts` calls the same functions with hostile input.
 *
 * ── The two invariants, and who upholds them ────────────────────────────────
 *
 *   Dense positions.  `normalizeOrder` renumbers to 0..n-1 after every mutation.
 *     Gaps are not wrong exactly, but they accumulate — delete the middle photo
 *     of twenty a few times and "position 14" stops meaning anything to anyone
 *     reading the database.
 *
 *   Exactly one cover.  MongoDB cannot express "one row per property with
 *     isPrimary=true" as a constraint, so the write path recomputes it on every
 *     mutation. The *read* path still tolerates violation: `primaryOf` accepts
 *     zero primaries (falls back to the first photo) and several (takes the
 *     first). Two concurrent requests losing a race should cost the seller a
 *     surprising cover choice, never a listing that renders no photo at all.
 */

/** The only fields ordering cares about. Deliberately not `PropertyMedia`: this
 *  module must be callable from a test without a Prisma row. */
export type MediaOrderRow = {
  readonly id: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
};

/** A row that needs writing back, with its new position and cover flag. */
export type MediaOrderUpdate = {
  readonly id: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
};

/**
 * Stable sort by position, with `id` as the tiebreak.
 *
 * The tiebreak matters: duplicate `sortOrder` values are possible on rows written
 * before a normalisation, and "whatever order Mongo returned" would make the
 * gallery reshuffle itself between two identical requests.
 */
export function sortMedia<T extends { readonly id: string; readonly sortOrder: number }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The cover photo, from an arbitrary row set.
 *
 * Tolerant by design — see the module header. Returns null only for an empty set,
 * which is the one case where "no cover" is the truth.
 */
export function primaryOf<T extends { readonly id: string; readonly sortOrder: number; readonly isPrimary: boolean }>(
  rows: readonly T[]
): T | null {
  const sorted = sortMedia(rows);
  return sorted.find((row) => row.isPrimary) ?? sorted[0] ?? null;
}

/**
 * Renumber to 0..n-1 and settle the cover flag.
 *
 * The cover is preserved if the set already has one (the first, if it somehow has
 * several); otherwise it falls to the first photo. That last part is what makes
 * "upload one photo" and "delete the cover" both end with a listing that still has
 * a cover, without either code path having to think about it.
 */
export function normalizeOrder<T extends MediaOrderRow>(rows: readonly T[]): MediaOrderUpdate[] {
  const sorted = sortMedia(rows);
  const primaryId = primaryOf(sorted)?.id ?? null;

  return sorted.map((row, index) => ({
    id: row.id,
    sortOrder: index,
    isPrimary: row.id === primaryId,
  }));
}

/**
 * Apply a client-supplied order.
 *
 * `orderedIds` is treated as a *preference*, not as the new truth, because it
 * arrives from a browser and may be stale, partial or hostile. Three rules make
 * every possible input safe:
 *
 *   - ids that are not in `rows` are ignored. A caller cannot pull another
 *     listing's photo into this gallery by naming it, and cannot make the request
 *     fail by naming a deleted one.
 *   - a repeated id counts once, at its first occurrence. A payload of
 *     `[a, a, a]` is `[a]` followed by everything else.
 *   - rows the caller omitted keep their existing relative order and are appended
 *     after the ones it named. A stale client that has not seen a photo uploaded
 *     in another tab therefore *moves* photos rather than losing them.
 *
 * Positions and the cover flag are then normalised, so the result is well-formed
 * regardless of how malformed the input was.
 */
export function applyReorder<T extends MediaOrderRow>(
  rows: readonly T[],
  orderedIds: readonly string[]
): MediaOrderUpdate[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const claimed = new Set<string>();
  const ordered: T[] = [];

  for (const id of orderedIds) {
    if (claimed.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    claimed.add(id);
    ordered.push(row);
  }

  // Whatever the caller did not mention, in its current order.
  for (const row of sortMedia(rows)) {
    if (!claimed.has(row.id)) ordered.push(row);
  }

  // `ordered` is already the intended sequence, so hand `normalizeOrder` positions
  // that reflect it rather than the stale ones on the rows.
  return normalizeOrder(
    ordered.map((row, index) => ({ ...row, sortOrder: index }))
  );
}

/**
 * Make one photo the cover.
 *
 * Returns null when the id is not in the set — the caller turns that into a 404,
 * which is also what a request naming *another owner's* media id gets, since such
 * a row is never in `rows` to begin with. Positions are untouched: choosing a
 * cover is not a reorder (see `prisma/schema.prisma` on why the two are separate
 * fields).
 */
export function applyPrimary<T extends MediaOrderRow>(
  rows: readonly T[],
  mediaId: string
): MediaOrderUpdate[] | null {
  if (!rows.some((row) => row.id === mediaId)) return null;

  return sortMedia(rows).map((row, index) => ({
    id: row.id,
    sortOrder: index,
    isPrimary: row.id === mediaId,
  }));
}

/**
 * Only the rows whose position or cover flag actually changed.
 *
 * A twenty-photo gallery reordered by one drag changes a handful of rows; writing
 * all twenty would make the transaction twenty updates wide for no reason. Rows
 * absent from `before` are reported as changed, so a freshly inserted row is
 * always written.
 */
export function diffOrder(
  before: readonly MediaOrderRow[],
  after: readonly MediaOrderUpdate[]
): MediaOrderUpdate[] {
  const previous = new Map(before.map((row) => [row.id, row]));

  return after.filter((row) => {
    const existing = previous.get(row.id);
    if (!existing) return true;
    return existing.sortOrder !== row.sortOrder || existing.isPrimary !== row.isPrimary;
  });
}

/** The position a newly uploaded photo takes: after everything already there.
 *  `-1 + 1 = 0` for an empty gallery, which is the intended first position. */
export function nextSortOrder(rows: readonly { readonly sortOrder: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}
