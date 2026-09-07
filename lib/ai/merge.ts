import type { BrowseQuery, BrowseSort } from "@/lib/properties/browse-query";
import {
  BROWSE_SORT_LABELS,
  DEFAULT_SORT,
  hasActiveFilters,
} from "@/lib/properties/browse-query";
import type { BrowseExtra } from "@/lib/properties/browse-where";
import { formatArea, formatPrice } from "@/lib/properties/format";
import {
  FURNISHING_LABELS,
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  SELLER_KIND_PLURAL_LABELS,
  amenityLabel,
} from "@/lib/properties/constants";

import {
  AI_PARKING_LABELS,
  PROXIMITY_LABELS,
  type AiCriteria,
  type AiProximityKind,
} from "./criteria";

/**
 * Where AI criteria meet the filters the visitor set by hand.
 *
 * ── The rule, and why it is written as data rather than prose ───────────────
 *
 * **A filter the visitor set explicitly always wins.** Not "usually", not "unless
 * the AI is more specific": a manual maximum of ₹70L stays ₹70L when the
 * assistant is asked for ₹90L, and the visitor is told that happened.
 *
 * The temptation is to write that as a chain of `if (manual) keep else take ai`,
 * which is correct and also silent — the disagreement disappears into the
 * result set, and the visitor sees a marketplace that ignored what they just
 * typed. So every field goes through `resolve()` below, which returns the value
 * *and* records the conflict when the two differed. Producing the explanation is
 * not a separate step that can be forgotten; it falls out of the merge.
 *
 * ── What counts as "explicit" ──────────────────────────────────────────────
 *
 * `parseBrowseQuery` leaves an unset filter as `null` (or `""`, `[]`, `false`),
 * so a non-empty value is one somebody put there — through the filter form, a
 * shared link, or a previous AI search the visitor chose to apply. There is no
 * separate "the user touched this" flag to keep in step, and there does not need
 * to be: the URL is the state, and a value in the URL is a stated requirement.
 *
 * `intentLocked` is the strongest form of that. On `/buy` the intent is the
 * page, so an assistant asked for rentals on the sale page cannot switch it; it
 * says so instead, which is more useful than quietly showing rentals under a
 * heading that says "for sale".
 *
 * ── Why the output is a `BrowseQuery` ──────────────────────────────────────
 *
 * Because then nothing downstream knows the AI was involved. The merged query
 * goes to the same `buildBrowseWhere` a hand-typed URL goes to, is subject to
 * the same non-negotiable `status: { in: LIVE_STATUSES }`, and serialises back
 * through `browseQueryString` into a link the visitor can share. Model output
 * cannot reach the database except as one of the closed set of values that type
 * admits — which is what makes "the AI cannot invent a property" structural
 * rather than a promise.
 *
 * Client-safe: pure functions over plain data, no Prisma runtime, no `server-only`.
 * The panel renders conflicts and chips from the same values the server used.
 */

// ─────────────────────────────────────────────────────────────
// Conflicts and notes
// ─────────────────────────────────────────────────────────────

export type AiConflict = {
  /** Stable id for React keys and tests; never shown. */
  readonly field: string;
  /** One sentence, addressed to the visitor, naming both values. */
  readonly message: string;
};

/**
 * Something the visitor asked for that this application cannot act on.
 *
 * Distinct from a conflict: a conflict is two answers to one question, this is
 * a question the marketplace has no data to answer. Both are shown, and neither
 * is inferred silently.
 */
export type AiUnsupported = {
  readonly kind: "proximity" | "amenity";
  readonly label: string;
  readonly message: string;
};

export type AiMergeResult = {
  /** The query actually run — manual filters intact, AI criteria filling the gaps. */
  readonly query: BrowseQuery;
  /** Predicates that have no URL representation. See `BrowseExtra`. */
  readonly extra: BrowseExtra;
  readonly conflicts: readonly AiConflict[];
  readonly unsupported: readonly AiUnsupported[];
};

// ─────────────────────────────────────────────────────────────
// Merging
// ─────────────────────────────────────────────────────────────

/**
 * Keep `manual` if it is set, otherwise take `ai` — and record the disagreement.
 *
 * `format` turns a value into the words the visitor recognises ("₹70 L", not
 * "7000000"), because a conflict message that quotes raw numbers is a message
 * nobody reads.
 */
function resolve<T>(
  field: string,
  label: string,
  manual: T | null,
  ai: T | null,
  format: (value: T) => string,
  conflicts: AiConflict[]
): T | null {
  if (manual === null) return ai;
  if (ai !== null && !Object.is(manual, ai)) {
    conflicts.push({
      field,
      message:
        `Your ${label} filter is set to ${format(manual)}, so I kept that ` +
        `instead of applying ${format(ai)}.`,
    });
  }
  return manual;
}

/**
 * Combine a parsed browse query with the criteria the assistant extracted.
 *
 * `manual` is whatever the page is currently showing — the filters in the URL.
 * Nothing is removed from it. Page is reset to 1 because the result set is about
 * to change, which is the same reason `filterHref` resets it.
 */
export function mergeAiCriteria(manual: BrowseQuery, criteria: AiCriteria): AiMergeResult {
  const conflicts: AiConflict[] = [];
  const unsupported: AiUnsupported[] = [];

  // The intent is the route on /buy and /rent. An assistant cannot navigate the
  // visitor somewhere else mid-search, so a mismatch is explained, not applied.
  let intent = manual.intent;
  if (manual.intentLocked) {
    if (criteria.listingType !== null && criteria.listingType !== manual.intent) {
      conflicts.push({
        field: "intent",
        message:
          `This page only shows listings ${LISTING_TYPE_LABELS[manual.intent as "BUY" | "RENT"].toLowerCase()}, ` +
          `so I did not switch to ${LISTING_TYPE_LABELS[criteria.listingType].toLowerCase()}. ` +
          `Explore covers both.`,
      });
    }
  } else {
    intent = resolve(
      "intent",
      "buy/rent",
      manual.intent,
      criteria.listingType,
      (value) => LISTING_TYPE_LABELS[value],
      conflicts
    );
  }

  const propertyType = resolve(
    "type",
    "property type",
    manual.propertyType,
    criteria.propertyType,
    (value) => PROPERTY_TYPE_LABELS[value],
    conflicts
  );

  const minPrice = resolve(
    "min",
    "minimum price",
    manual.minPrice,
    criteria.minPrice,
    formatPrice,
    conflicts
  );
  const maxPriceResolved = resolve(
    "max",
    "maximum price",
    manual.maxPrice,
    criteria.maxPrice,
    formatPrice,
    conflicts
  );

  const minBedrooms = resolve(
    "beds",
    "bedrooms",
    manual.minBedrooms,
    criteria.bedrooms,
    (value) => `${value}+ BHK`,
    conflicts
  );
  const minBathrooms = resolve(
    "baths",
    "bathrooms",
    manual.minBathrooms,
    criteria.bathrooms,
    (value) => `${value}+`,
    conflicts
  );

  const minArea = resolve(
    "amin",
    "minimum area",
    manual.minArea,
    criteria.minArea,
    (value) => formatArea(value, "SQFT"),
    conflicts
  );
  const maxAreaResolved = resolve(
    "amax",
    "maximum area",
    manual.maxArea,
    criteria.maxArea,
    (value) => formatArea(value, "SQFT"),
    conflicts
  );

  const furnishing = resolve(
    "furnishing",
    "furnishing",
    manual.furnishing,
    criteria.furnishing,
    (value) => FURNISHING_LABELS[value],
    conflicts
  );

  const sellerKind = resolve(
    "seller",
    "posted by",
    manual.sellerKind,
    criteria.sellerKind,
    (value) => SELLER_KIND_PLURAL_LABELS[value],
    conflicts
  );

  // The free-text box and the assistant's place name are the same slot. A
  // visitor who typed "Andheri" and then asked about Vikhroli gets Andheri and
  // an explanation — the box is on screen and they can clear it.
  const q = resolve(
    "q",
    "search",
    manual.q === "" ? null : manual.q,
    criteria.location,
    (value) => `“${value}”`,
    conflicts
  );

  // Parking splits: the four enum members are a filter the URL already carries,
  // while "any parking" has no representation there and becomes an extra
  // predicate. Both are still subject to the manual filter winning.
  let parking = manual.parking;
  let requireParking = false;
  if (manual.parking === null) {
    if (criteria.parking === "ANY") requireParking = true;
    else parking = criteria.parking;
  } else if (criteria.parking !== null && criteria.parking !== manual.parking) {
    conflicts.push({
      field: "parking",
      message:
        `Your parking filter is set to ${AI_PARKING_LABELS[manual.parking].toLowerCase()}, ` +
        `so I kept that instead of applying ${AI_PARKING_LABELS[criteria.parking].toLowerCase()}.`,
    });
  }

  // Amenities are additive rather than exclusive: two lists of things a listing
  // must have are one longer list. Nothing the visitor ticked is dropped, so
  // there is no conflict to report.
  const amenities = [...new Set([...manual.amenities, ...criteria.amenities])].sort();

  // "Verified only" can only be turned on, never off, by the assistant: it is a
  // trust filter, and an assistant that quietly widened a visitor's trust bar
  // would be doing the one thing this merge exists to prevent.
  const verifiedOnly = manual.verifiedOnly || criteria.verifiedOnly;

  const sort: BrowseSort =
    manual.sort !== DEFAULT_SORT ? manual.sort : (criteria.sort ?? manual.sort);
  if (manual.sort !== DEFAULT_SORT && criteria.sort !== null && criteria.sort !== manual.sort) {
    conflicts.push({
      field: "sort",
      message:
        `Results stay sorted by ${BROWSE_SORT_LABELS[manual.sort].toLowerCase()}, ` +
        `the order you chose, rather than ${BROWSE_SORT_LABELS[criteria.sort].toLowerCase()}.`,
    });
  }

  for (const kind of criteria.proximity) {
    unsupported.push({
      kind: "proximity",
      label: PROXIMITY_LABELS[kind],
      message: proximityMessage(kind, q ?? criteria.location),
    });
  }

  const query: BrowseQuery = {
    ...manual,
    intent,
    q: q ?? "",
    propertyType,
    minPrice,
    maxPrice:
      maxPriceResolved !== null && minPrice !== null && maxPriceResolved < minPrice
        ? null
        : maxPriceResolved,
    minBedrooms,
    minBathrooms,
    minArea,
    maxArea:
      maxAreaResolved !== null && minArea !== null && maxAreaResolved < minArea
        ? null
        : maxAreaResolved,
    furnishing,
    parking,
    amenities,
    sellerKind,
    verifiedOnly,
    sort,
    // A new question is a new result set; page 4 of the previous one says
    // nothing about it.
    page: 1,
  };

  return { query, extra: { requireParking }, conflicts, unsupported };
}

/**
 * What to say about a landmark nobody can measure the distance to.
 *
 * Names the listing field that *does* exist — the locality — so the sentence
 * ends with something the visitor can act on instead of an apology. No listing
 * in this schema carries a distance or a travel time to anything; see
 * `AI_PROXIMITY_KINDS` and `lib/maps/nearby.ts`.
 */
function proximityMessage(kind: AiProximityKind, place: string | null): string {
  const what = PROXIMITY_LABELS[kind].toLowerCase();
  const where = place ? ` I searched ${place} by name instead.` : "";
  return `Listings on PROPERTYNEX do not record their distance to the nearest ${what}, so I could not filter or rank by it.${where}`;
}

// ─────────────────────────────────────────────────────────────
// Describing what was understood
// ─────────────────────────────────────────────────────────────

export type AiCriteriaChip = {
  readonly id: string;
  readonly label: string;
  /** False for a criterion that was understood but could not be applied. */
  readonly applied: boolean;
};

/**
 * "AI understood: 2 bedrooms · ≤ ₹80 L · Vikhroli · Parking".
 *
 * Built from the criteria rather than from the merged query on purpose: the two
 * differ exactly where a manual filter overrode something, and the visitor needs
 * to see both halves — what was understood here, and what was actually applied
 * in the conflict notes beside it.
 */
export function aiCriteriaChips(criteria: AiCriteria): AiCriteriaChip[] {
  const chips: AiCriteriaChip[] = [];
  const add = (id: string, label: string, applied = true) => chips.push({ id, label, applied });

  if (criteria.listingType !== null) {
    add("intent", LISTING_TYPE_LABELS[criteria.listingType]);
  }
  if (criteria.propertyType !== null) add("type", PROPERTY_TYPE_LABELS[criteria.propertyType]);
  if (criteria.bedrooms !== null) add("beds", `${criteria.bedrooms}+ BHK`);
  if (criteria.bathrooms !== null) add("baths", `${criteria.bathrooms}+ bath`);

  if (criteria.minPrice !== null && criteria.maxPrice !== null) {
    add("price", `${formatPrice(criteria.minPrice)} – ${formatPrice(criteria.maxPrice)}`);
  } else if (criteria.maxPrice !== null) {
    add("price", `≤ ${formatPrice(criteria.maxPrice)}`);
  } else if (criteria.minPrice !== null) {
    add("price", `${formatPrice(criteria.minPrice)}+`);
  }

  if (criteria.location !== null) add("location", criteria.location);

  if (criteria.minArea !== null && criteria.maxArea !== null) {
    add("area", `${formatArea(criteria.minArea, "SQFT")} – ${formatArea(criteria.maxArea, "SQFT")}`);
  } else if (criteria.minArea !== null) {
    add("area", `${formatArea(criteria.minArea, "SQFT")}+`);
  } else if (criteria.maxArea !== null) {
    add("area", `Up to ${formatArea(criteria.maxArea, "SQFT")}`);
  }

  if (criteria.furnishing !== null) add("furnishing", FURNISHING_LABELS[criteria.furnishing]);
  if (criteria.parking !== null) add("parking", AI_PARKING_LABELS[criteria.parking]);

  for (const slug of criteria.amenities) add(`amenity:${slug}`, amenityLabel(slug));

  if (criteria.sellerKind !== null) add("seller", SELLER_KIND_PLURAL_LABELS[criteria.sellerKind]);
  if (criteria.verifiedOnly) add("verified", "Verified only");
  if (criteria.sort !== null) add("sort", BROWSE_SORT_LABELS[criteria.sort]);

  // Understood, and marked as not applied — the chip is struck through in the
  // panel rather than omitted, so the visitor can see their whole sentence was
  // read even where the data runs out.
  for (const kind of criteria.proximity) {
    add(`proximity:${kind}`, `Near a ${PROXIMITY_LABELS[kind].toLowerCase()}`, false);
  }

  return chips;
}

/** Did the visitor already have filters on when they asked? Used to decide
 *  whether the panel needs to explain the combination at all. */
export function hasManualFilters(query: BrowseQuery): boolean {
  return hasActiveFilters(query);
}
