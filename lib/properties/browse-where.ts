/**
 * `BrowseQuery` → the Prisma `where` and `orderBy` that answer it.
 *
 * ── Why this is separate from the module that runs the query ────────────────
 *
 * Everything here is a pure function of its argument: no `prisma` import, no
 * `await`, no I/O. That is what makes the filter logic testable — the browse
 * spec's "2BHK + Vikhroli + Under ₹80L + Parking should return properties
 * matching all selected criteria" is a claim about the *shape* of a query
 * object, and asserting it against a real database would mean seeding one and
 * would still not prove the clause was built right. `tests/unit/browse-where.test.ts`
 * asserts on the object instead.
 *
 * The Prisma import is type-only, so this module has no runtime dependency on
 * the client. `lib/properties/public.ts` is where it actually meets the database.
 *
 * ── The one invariant ──────────────────────────────────────────────────────
 *
 * `status: { in: LIVE_STATUSES }` is written first and is not conditional on
 * anything. Every other clause narrows an already-live set. There is no branch,
 * no parameter and no filter value that can widen it — which is the whole reason
 * the browse path is safe to serve to anonymous visitors, and why "do not trust
 * client-side filtering for authorization" is satisfied structurally rather than
 * by a rule somebody has to remember.
 */

import type { AreaUnit, Prisma } from "@prisma/client";

import { AREA_SQFT_FACTORS, fromSqft } from "./area";
import { propertyTypesMatching, type BrowseQuery, type BrowseSort } from "./browse-query";
import { SELLER_KIND_ROLES } from "./constants";
import { LIVE_STATUSES } from "./status";

const AREA_UNITS = Object.keys(AREA_SQFT_FACTORS) as AreaUnit[];

/**
 * The area filter, expanded across every unit a listing might be stored in.
 *
 * "At least 1,000 sq ft" cannot be asked of the `areaValue` column directly,
 * because what that number means depends on the row's own `areaUnit`. So the
 * *threshold* is converted instead — once per unit — and the five results are
 * OR'd: a row matches if its unit is SQM and its value clears 92.9, or its unit
 * is ACRE and its value clears 0.023, and so on. See ./area for why converting
 * the question beats denormalising the answer.
 *
 * Returned as a list of `PropertyWhereInput` for the caller to place in an
 * `AND`, never assigned to `where.OR` — the free-text search owns that slot, and
 * two writers to one `OR` is one silently overwriting the other.
 */
function areaClause(minSqft: number | null, maxSqft: number | null): Prisma.PropertyWhereInput {
  const branches: Prisma.PropertyWhereInput[] = AREA_UNITS.map((unit) => ({
    areaUnit: unit,
    areaValue: {
      ...(minSqft !== null ? { gte: fromSqft(minSqft, unit) } : {}),
      ...(maxSqft !== null ? { lte: fromSqft(maxSqft, unit) } : {}),
    },
  }));
  return { OR: branches };
}

/**
 * The free-text clause.
 *
 * Substring, case-insensitive, across the fields a visitor types into a property
 * search: the listing's own title, the three geographic fields that make up a
 * public address (locality, city, state), and the pincode. Plus — the part a
 * plain `contains` cannot do — any property *type* whose name the text matches,
 * because `propertyType` is an enum column and "villa" has to be resolved to
 * `VILLA` before it can be compared. See `propertyTypesMatching`.
 *
 * `addressLine1` and `addressLine2` are deliberately NOT searched, and the reason
 * is the same one that keeps them out of `PublicListing`: they are the exact
 * door. A search box that matched them would answer "does a live listing exist
 * at this street address" for any address a stranger cares to try, which is a
 * disclosure the projection is specifically built to prevent. `pincode` is
 * searched because a pincode is public geography, not a listing's secret — it
 * says no more than the locality already does, and typing one is a completely
 * ordinary way to search.
 *
 * Not a full-text index: this phase has no search infrastructure, and `contains`
 * over an indexed `city` is the honest intermediate step rather than a
 * relevance ranking that only pretends to be one.
 */
function searchClause(text: string): Prisma.PropertyWhereInput {
  const contains = { contains: text, mode: "insensitive" as const };
  const branches: Prisma.PropertyWhereInput[] = [
    { title: contains },
    { locality: contains },
    { city: contains },
    { state: contains },
    { pincode: contains },
  ];

  const types = propertyTypesMatching(text);
  if (types.length > 0) branches.push({ propertyType: { in: types } });

  return { OR: branches };
}

/**
 * Predicates a browse query can carry that the URL vocabulary cannot express.
 *
 * ── Why this exists, and why it is a named record and not a `where` fragment ─
 *
 * "With parking" — no particular kind, just some — is an ordinary thing to ask
 * for and is not a member of `ParkingType`. The enum's four members describe
 * what a listing *has*, and they are also the write vocabulary, so adding an
 * "any" member there would let a seller store "any" as a fact about their
 * property. The request therefore lives here instead of in `BrowseQuery`.
 *
 * The type is a closed record of named booleans rather than a
 * `Prisma.PropertyWhereInput` the caller assembles, and that is the whole safety
 * argument: an escape hatch shaped like a raw `where` is one that can eventually
 * *widen* the query — including past the `status` invariant this module's header
 * calls non-negotiable. A named flag can only be translated into the one clause
 * written for it, below, and adding a second flag is a visible edit to this file
 * with a test attached rather than a call site quietly passing more.
 *
 * Every field is optional and absent means "no extra predicate", so existing
 * callers are unaffected — `buildBrowseWhere(query)` and
 * `buildBrowseWhere(query, savedIds)` behave exactly as before.
 */
export type BrowseExtra = {
  /**
   * The listing must have parking of some kind.
   *
   * `NONE` is excluded, and so is a listing that never stated one: a null column
   * is missing information, not a promise of a parking space. That asymmetry is
   * the same one `lib/ai/match.ts` scores — unknown is neither a match nor a
   * miss — and it is why this cannot be written as `NOT: { parking: "NONE" }`,
   * which in SQL keeps the nulls out anyway but reads as though it would not.
   */
  readonly requireParking?: boolean;
};

/** Every parking value that counts as "has parking". */
const PARKING_PRESENT = ["OPEN", "COVERED", "BOTH"] as const;

/**
 * Build the `where` for a browse query.
 *
 * `savedIds` is supplied by the caller when the visitor asked for saved listings
 * only — resolved from the *session*, never from the URL. Passing `null` for it
 * while `query.savedOnly` is set is not an error and not "no filter": it means
 * nobody is signed in, and the clause becomes `id: { in: [] }`, an honest empty
 * result rather than the whole marketplace.
 *
 * `extra` carries the predicates that have no URL representation — see
 * `BrowseExtra`. It can only narrow: every flag it defines is pushed onto `AND`,
 * never onto the object directly and never onto `status`.
 */
export function buildBrowseWhere(
  query: BrowseQuery,
  savedIds: readonly string[] | null = null,
  extra: BrowseExtra = {}
): Prisma.PropertyWhereInput {
  // Every clause that could be independently true goes in `AND` rather than onto
  // the object directly, so no two of them can collide over `OR`.
  const and: Prisma.PropertyWhereInput[] = [];

  const where: Prisma.PropertyWhereInput = {
    // Not conditional, not overridable, and first for a reason: a DRAFT,
    // UNPUBLISHED or PENDING_VERIFICATION listing must never reach an anonymous
    // visitor. `LIVE_STATUSES` is shared with the owner-side status machine, so
    // "live" has exactly one definition in the codebase.
    status: { in: [...LIVE_STATUSES] },
  };

  // `verifiedOnly` narrows the same field further. Written as an intersection of
  // the two rather than a replacement, so it cannot accidentally *widen* the
  // status set if VERIFIED were ever removed from LIVE_STATUSES.
  if (query.verifiedOnly) {
    and.push({ status: "VERIFIED" });
  }

  if (query.intent !== null) where.listingType = query.intent;
  if (query.propertyType !== null) where.propertyType = query.propertyType;

  if (query.minBedrooms !== null) where.bedrooms = { gte: query.minBedrooms };
  if (query.minBathrooms !== null) where.bathrooms = { gte: query.minBathrooms };

  if (query.minPrice !== null || query.maxPrice !== null) {
    where.price = {
      ...(query.minPrice !== null ? { gte: query.minPrice } : {}),
      ...(query.maxPrice !== null ? { lte: query.maxPrice } : {}),
    };
  }

  if (query.minArea !== null || query.maxArea !== null) {
    and.push(areaClause(query.minArea, query.maxArea));
  }

  if (query.furnishing !== null) where.furnishing = query.furnishing;

  // "Parking" as a filter means *has* parking, so selecting COVERED must not
  // also return the BOTH listings' opposite — but selecting NONE must return
  // only NONE. The enum's members are exclusive descriptions of what exists, so
  // BOTH satisfies a request for OPEN or for COVERED, and nothing else expands.
  if (query.parking !== null) {
    where.parking =
      query.parking === "OPEN" || query.parking === "COVERED"
        ? { in: [query.parking, "BOTH"] }
        : query.parking;
  }

  // `hasEvery`, not `hasSome`: the browse spec's worked example is an AND across
  // criteria, and a buyer ticking "lift" and "power backup" wants both.
  if (query.amenities.length > 0) {
    where.amenities = { hasEvery: [...query.amenities] };
  }

  // A relation filter rather than a two-query id lookup: one round trip, and the
  // role set stays where it is defined. ADMIN is in no bucket, so an admin-owned
  // listing is unreachable by this filter and reachable by every other one.
  if (query.sellerKind !== null) {
    where.owner = { is: { role: { in: [...SELLER_KIND_ROLES[query.sellerKind]] } } };
  }

  if (query.savedOnly) {
    where.id = { in: savedIds === null ? [] : [...savedIds] };
  }

  if (query.q !== "") and.push(searchClause(query.q));

  // "Some parking", from the AI assistant. Written as an explicit `in` over the
  // three affirmative members rather than as a negation, so a listing whose
  // `parking` column was never filled in is excluded — unknown is not a yes.
  if (extra.requireParking) {
    and.push({ parking: { in: [...PARKING_PRESENT] } });
  }

  if (and.length > 0) where.AND = and;

  return where;
}

/**
 * The `orderBy` for a sort.
 *
 * An array in every case, and every one ends with `{ id: "desc" }`. Without a
 * unique final tiebreak, two rows with the same price have no defined relative
 * order, and MongoDB is free to return them differently between the query for
 * page 1 and the query for page 2 — which shows the visitor one listing twice
 * and hides another entirely. The id is unique and monotonic, so it settles
 * every tie the preceding keys leave open.
 *
 * `relevance` is not a scoring function; it is an editorial ordering, and the
 * name is honest about being the default rather than claiming to be computed.
 * `status: "desc"` puts VERIFIED first — MongoDB stores enum members as their
 * string names, and "VERIFIED" sorts after "PUBLISHED" lexicographically, which
 * is a property worth knowing is load-bearing (there is a test pinning it) since
 * renaming either member would silently invert the marketplace's front page.
 */
export function browseOrderBy(sort: BrowseSort): Prisma.PropertyOrderByWithRelationInput[] {
  switch (sort) {
    case "price-asc":
      return [{ price: "asc" }, { id: "desc" }];
    case "price-desc":
      return [{ price: "desc" }, { id: "desc" }];
    case "newest":
      return [{ createdAt: "desc" }, { id: "desc" }];
    // No scorer is installed (see ./ai), so `ai-match` is unreachable through
    // `parseBrowseQuery` — which withholds the option. It shares relevance's
    // ordering rather than returning an empty `orderBy`, which would leave
    // pagination unstable if a scorer were installed and this were forgotten.
    case "ai-match":
    case "relevance":
      return [{ status: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  }
  // No `default`. The switch is exhaustive over `BrowseSort`, so adding a sort
  // without deciding how it orders is a compile error rather than a silent
  // fallback to relevance.
}
