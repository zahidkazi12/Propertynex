/**
 * The browse query: what a visitor can ask the marketplace for, and how that
 * question survives a round trip through a URL.
 *
 * ── One source of truth, and it is the URL ──────────────────────────────────
 *
 * There is no client-side filter state anywhere in this feature. The URL holds
 * the entire question; the server parses it, runs it, and renders the answer.
 * Every consequence of that falls out for free: a filtered result set is
 * linkable, the back button steps through filter history, a refresh is not a
 * reset, and — the part that matters most — there is no second copy of the
 * filters in a browser that could disagree with the one the database was asked.
 *
 * ── Why parsing is total, and never throws ─────────────────────────────────
 *
 * A query string is attacker-controlled input that arrives on a page anyone can
 * load. `parseBrowseQuery` therefore does not validate-and-reject; it *coerces*.
 * Every field has a defined result for every possible input, and anything
 * unrecognised is dropped rather than surfaced as an error. `?beds=🐈` is not a
 * 400 — it is a browse page with no bedroom filter, because a stranger pasting a
 * mangled link should see listings, not a stack trace, and because a parser that
 * can throw is a parser that can be made to throw.
 *
 * The output of this module is a `BrowseQuery` and nothing else. That is the
 * only shape `buildWhere()` in lib/properties/public.ts will accept, so a raw
 * query-string value cannot reach a database filter without passing through
 * here. Enum-valued fields are narrowed against the label records in
 * ./constants, which are derived from the Prisma enums — so the set of accepted
 * values cannot drift from the set of storable values.
 *
 * ── Client-safe ────────────────────────────────────────────────────────────
 *
 * The filter form is a Client Component and needs the field names, the sort
 * list and the chip labels. So this module holds the vocabulary and the parsing,
 * and lib/properties/public.ts holds the Prisma query — the split exists purely
 * so that importing "what a filter is called" does not pull the database client
 * into the browser bundle. The only Prisma import here is type-only.
 */

import type { Furnishing, ListingType, ParkingType, PropertyType } from "@prisma/client";

import { MAX_AREA_SQFT } from "./area";
import {
  AMENITY_SLUGS,
  FURNISHING_LABELS,
  isKnownAmenity,
  isSellerKind,
  MAX_ROOM_COUNT,
  PARKING_LABELS,
  PROPERTY_TYPE_LABELS,
  SELLER_KIND_PLURAL_LABELS,
  amenityLabel,
  type SellerKind,
} from "./constants";
import { formatArea, formatPrice } from "./format";

// ─────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────

/**
 * `ai-match` is listed here and is deliberately not always offered.
 *
 * The browse spec asks for an AI match score "when AI functionality is
 * available", and in this deployment it is not: nothing in package.json talks to
 * a model. Two ways to honour that. Ship the option and have it silently sort by
 * something else — a lie in the UI. Or leave the *vocabulary* complete and let
 * whoever renders the control decide whether the option exists, which is what
 * happens: `lib/properties/ai.ts` decides, the page passes the surviving list to
 * `parseBrowseQuery` as `allowedSorts`, and a hand-typed `?sort=ai-match` falls
 * back to the default instead of being honoured.
 *
 * The availability check lives on the server precisely so this module stays
 * pure — a `process.env` read here would be inlined as `undefined` in the client
 * bundle and disagree with the server on first render.
 *
 * ── Why there is no "largest area" sort ────────────────────────────────────
 *
 * There was one, and it was wrong. Area is stored as a `{ areaValue, areaUnit }`
 * pair across five units, so `orderBy: { areaValue: "desc" }` puts a 500 sq ft
 * studio above a 2-acre farmhouse — the numbers 500 and 2 compared with the
 * units thrown away. The filter can convert a *threshold* per unit (see ./area);
 * a sort cannot, because there is no single expression to order by. Doing it
 * properly needs a denormalised square-foot column maintained by the write path,
 * which is a change to the create/update routes and not to this one. It is not
 * among the sorts the browse spec asks for, so it is gone rather than shipped
 * knowingly broken.
 */
export const BROWSE_SORTS = [
  "relevance",
  "newest",
  "price-asc",
  "price-desc",
  "ai-match",
] as const;

export type BrowseSort = (typeof BROWSE_SORTS)[number];

export const BROWSE_SORT_LABELS: Record<BrowseSort, string> = {
  relevance: "Most relevant",
  newest: "Newest first",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "ai-match": "AI match score",
};

/**
 * What a visitor gets when they have not chosen.
 *
 * Relevance, not newest. "Newest" is the honest default only for a feed; for a
 * marketplace it means a listing's worth decays by the hour, and a verified
 * listing posted last week loses to an unverified one posted this morning.
 */
export const DEFAULT_SORT: BrowseSort = "relevance";

// ─────────────────────────────────────────────────────────────
// Bounds
// ─────────────────────────────────────────────────────────────

/** Results per page. Twelve divides evenly by the 1/2/3-column grid. */
export const BROWSE_PER_PAGE = 12;

/**
 * How deep pagination is allowed to go.
 *
 * `skip` on a large collection costs the database more the further in you go, and
 * page 500 of a browse result is a crawler, not a buyer. Anything beyond clamps
 * rather than erroring.
 */
export const MAX_PAGE = 500;

/** Longest free-text query accepted. Anything longer is truncated, not refused. */
export const MAX_QUERY_LENGTH = 80;

/** Validation ceiling for a budget figure, well above any real listing. */
export const MAX_PRICE = 1e12;

/**
 * A free-text query shorter than this does not expand into property-type names.
 *
 * "a" appears in most of the labels, so a one- or two-letter query would add
 * nearly every type to the OR and drown the results it was meant to sharpen.
 * The substring match on title/locality/city still runs at any length.
 */
const MIN_TYPE_MATCH_LENGTH = 3;

// ─────────────────────────────────────────────────────────────
// Field names
// ─────────────────────────────────────────────────────────────

/**
 * The names of the query-string parameters, in one place.
 *
 * The filter form's `name` attributes, the parser's reads, and the link builder's
 * writes are three copies of the same contract, and the failure mode when they
 * drift is silent: a renamed input still submits, the parser still returns a
 * valid query, and the filter simply stops working. Naming them once turns that
 * into a compile error.
 *
 * They are short because they end up in a shared URL. Some abbreviate
 * (`amin`/`amax`); those are the ones that would otherwise collide with a longer
 * name a reader could confuse for the price bounds.
 */
export const BROWSE_FIELDS = {
  intent: "intent",
  q: "q",
  propertyType: "type",
  minPrice: "min",
  maxPrice: "max",
  minBedrooms: "beds",
  minBathrooms: "baths",
  minArea: "amin",
  maxArea: "amax",
  furnishing: "furnishing",
  parking: "parking",
  amenity: "amenity",
  sellerKind: "seller",
  verifiedOnly: "verified",
  savedOnly: "saved",
  sort: "sort",
  view: "view",
  page: "page",
} as const;

/**
 * List or map.
 *
 * A *display* concern, not a filter — which is why it lives beside `sort` rather
 * than among the predicates, and why `hasActiveFilters` and `activeFilterChips`
 * ignore it. Switching to the map narrows nothing; offering a "clear" chip for it
 * would imply it does.
 *
 * It is still carried in the URL, for the reason every other parameter here is:
 * a result set is shareable, and someone who sends a colleague the map of
 * three-bedroom flats in Indiranagar should not have them land on the list.
 */
export const BROWSE_VIEWS = ["list", "map"] as const;
export type BrowseView = (typeof BROWSE_VIEWS)[number];

export const DEFAULT_VIEW: BrowseView = "list";

// ─────────────────────────────────────────────────────────────
// The query
// ─────────────────────────────────────────────────────────────

export type BrowseQuery = {
  /**
   * Buy, rent, or both. `null` means both, and is only reachable on `/explore` —
   * `/buy` and `/rent` pin it.
   */
  readonly intent: ListingType | null;
  /**
   * True when the *route* pinned the intent rather than the visitor choosing it.
   *
   * Load-bearing in two places: the intent control renders as a link set (you
   * navigate between three pages) instead of a filter, and `browseQueryString`
   * omits `intent` from the URL, because on `/buy` it is implied by the path and
   * `?intent=BUY` would be noise a reader might think they could change.
   */
  readonly intentLocked: boolean;

  readonly q: string;
  readonly propertyType: PropertyType | null;

  readonly minPrice: number | null;
  readonly maxPrice: number | null;

  readonly minBedrooms: number | null;
  readonly minBathrooms: number | null;

  /** Square feet. Compared against rows stored in any unit; see ./area. */
  readonly minArea: number | null;
  readonly maxArea: number | null;

  readonly furnishing: Furnishing | null;
  readonly parking: ParkingType | null;

  /** Allowlisted slugs, deduplicated and sorted. A listing must have them all. */
  readonly amenities: readonly string[];

  readonly sellerKind: SellerKind | null;
  readonly verifiedOnly: boolean;

  /**
   * "Only listings I have saved."
   *
   * Answerable only for a signed-in visitor, and the browse query resolves it
   * against the session rather than against anything in the URL — see
   * `browsePublicListings`. A signed-out visitor who hand-types `?saved=1` gets
   * an empty result set, not somebody else's saved listings.
   */
  readonly savedOnly: boolean;

  readonly sort: BrowseSort;

  /**
   * Which presentation of the same result set the visitor asked for.
   *
   * Deliberately not part of the `where`: list and map render identical data, so
   * a listing that is absent from one is absent from both. That is what makes the
   * map trustworthy as a view of the current filters rather than a second,
   * differently-filtered dataset.
   */
  readonly view: BrowseView;

  readonly page: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type BrowseParseOptions = {
  /** Set by `/buy` and `/rent`. `null`/absent leaves the visitor in control. */
  readonly lockedIntent?: ListingType | null;
  /** Defaults to every sort. Pass a narrower list to withhold one. */
  readonly allowedSorts?: readonly BrowseSort[];
};

// ─────────────────────────────────────────────────────────────
// Coercion helpers
// ─────────────────────────────────────────────────────────────

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every value for a repeatable parameter, whether repeated or comma-joined. */
function every(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.flatMap((entry) => entry.split(",")).map((entry) => entry.trim());
}

function positiveNumber(value: string | undefined, max: number): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, max);
}

function integerInRange(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * A checkbox. An unchecked box submits nothing at all, so only the affirmative
 * spellings need recognising — and `"0"`/`"false"` must read as off rather than
 * as "present, therefore true".
 */
function flag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "on" || normalised === "yes";
}

/**
 * Characters a search box may contain: letters and digits in any script, plus
 * the punctuation that shows up in Indian place and building names.
 *
 * Everything else — including every regex metacharacter that could quantify,
 * group, anchor or negate — is replaced with a space. Prisma escapes the operand
 * of `contains` before it reaches MongoDB's `$regex`, so this is not the only
 * thing standing between a visitor and a pathological pattern; it is the layer
 * that does not depend on that remaining true. Replacing with a space rather
 * than deleting keeps `"3BHK*Vikhroli"` from collapsing into one unmatchable
 * token.
 */
const SEARCH_DISALLOWED = /[^\p{L}\p{N} ,.'&/#-]+/gu;

function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(SEARCH_DISALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function parseIntent(value: string | undefined): ListingType | null {
  const normalised = (value ?? "").trim().toUpperCase();
  return normalised === "BUY" || normalised === "RENT" ? normalised : null;
}

/**
 * Which property types a free-text query names.
 *
 * `propertyType` is a Prisma enum, so it takes `equals`/`in` and not `contains` —
 * a visitor typing "villa" cannot be matched against the column directly. The
 * text is resolved to enum members *here* instead, and the caller adds them to
 * the search OR as an `in` clause. Matching runs against both the human label
 * ("Apartment / Flat") and the enum key with its underscores opened out
 * ("independent house"), so either spelling finds it.
 */
export function propertyTypesMatching(text: string): PropertyType[] {
  const needle = text.trim().toLowerCase();
  if (needle.length < MIN_TYPE_MATCH_LENGTH) return [];

  const keys = Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[];
  return keys.filter((type) => {
    const label = PROPERTY_TYPE_LABELS[type].toLowerCase();
    const key = type.toLowerCase().replace(/_/g, " ");
    return label.includes(needle) || key.includes(needle);
  });
}

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

export function parseBrowseQuery(
  params: RawSearchParams,
  options: BrowseParseOptions = {}
): BrowseQuery {
  const lockedIntent = options.lockedIntent ?? null;
  const allowedSorts = options.allowedSorts ?? BROWSE_SORTS;

  const rawType = first(params[BROWSE_FIELDS.propertyType]);
  const propertyType =
    rawType && rawType in PROPERTY_TYPE_LABELS ? (rawType as PropertyType) : null;

  const rawFurnishing = first(params[BROWSE_FIELDS.furnishing]);
  const furnishing =
    rawFurnishing && rawFurnishing in FURNISHING_LABELS ? (rawFurnishing as Furnishing) : null;

  const rawParking = first(params[BROWSE_FIELDS.parking]);
  const parking = rawParking && rawParking in PARKING_LABELS ? (rawParking as ParkingType) : null;

  const rawSeller = (first(params[BROWSE_FIELDS.sellerKind]) ?? "").trim().toLowerCase();
  const sellerKind = isSellerKind(rawSeller) ? rawSeller : null;

  const minPrice = positiveNumber(first(params[BROWSE_FIELDS.minPrice]), MAX_PRICE);
  const maxPrice = positiveNumber(first(params[BROWSE_FIELDS.maxPrice]), MAX_PRICE);
  const minArea = positiveNumber(first(params[BROWSE_FIELDS.minArea]), MAX_AREA_SQFT);
  const maxArea = positiveNumber(first(params[BROWSE_FIELDS.maxArea]), MAX_AREA_SQFT);

  const rawSort = first(params[BROWSE_FIELDS.sort]);
  const sort = allowedSorts.find((candidate) => candidate === rawSort) ?? DEFAULT_SORT;

  // Unknown values fall back to the list rather than erroring: `?view=satellite`
  // is a typo or a stale bookmark, and the honest response to it is the default
  // presentation of the same results.
  const rawView = first(params[BROWSE_FIELDS.view]);

  // Deduplicated and sorted so that two URLs expressing the same amenity set are
  // the same URL — the filter is an unordered AND, and `hasEvery` treats it as
  // one, so the query string should not pretend the order carries meaning.
  const amenities = [...new Set(every(params[BROWSE_FIELDS.amenity]).filter(isKnownAmenity))]
    .sort()
    .slice(0, AMENITY_SLUGS.length);

  return {
    intent: lockedIntent ?? parseIntent(first(params[BROWSE_FIELDS.intent])),
    intentLocked: lockedIntent !== null,

    q: cleanText(first(params[BROWSE_FIELDS.q])),
    propertyType,

    minPrice,
    // An inverted range is dropped from the top, not swapped. Swapping would
    // silently answer a question the visitor did not ask; dropping leaves the
    // bound they typed first intact and the other input visibly empty, which is
    // a state they can see and correct.
    maxPrice: maxPrice !== null && minPrice !== null && maxPrice < minPrice ? null : maxPrice,

    minBedrooms: integerInRange(first(params[BROWSE_FIELDS.minBedrooms]), 1, MAX_ROOM_COUNT),
    minBathrooms: integerInRange(first(params[BROWSE_FIELDS.minBathrooms]), 1, MAX_ROOM_COUNT),

    minArea,
    maxArea: maxArea !== null && minArea !== null && maxArea < minArea ? null : maxArea,

    furnishing,
    parking,
    amenities,

    sellerKind,
    verifiedOnly: flag(first(params[BROWSE_FIELDS.verifiedOnly])),
    savedOnly: flag(first(params[BROWSE_FIELDS.savedOnly])),

    sort,
    view: BROWSE_VIEWS.find((candidate) => candidate === rawView) ?? DEFAULT_VIEW,
    page: integerInRange(first(params[BROWSE_FIELDS.page]), 1, MAX_PAGE) ?? 1,
  };
}

// ─────────────────────────────────────────────────────────────
// Inspecting a query
// ─────────────────────────────────────────────────────────────

/**
 * Has the visitor narrowed anything?
 *
 * Sort, view and page are excluded: none of them removes a listing from the
 * result set, so none can be the reason a result set is empty — and telling
 * someone to "clear your filters" when all they did was turn to page 9, or switch
 * to the map, would be wrong. The intent counts only when the visitor chose it,
 * since on `/buy` it is the page.
 */
export function hasActiveFilters(query: BrowseQuery): boolean {
  return (
    (!query.intentLocked && query.intent !== null) ||
    query.q !== "" ||
    query.propertyType !== null ||
    query.minPrice !== null ||
    query.maxPrice !== null ||
    query.minBedrooms !== null ||
    query.minBathrooms !== null ||
    query.minArea !== null ||
    query.maxArea !== null ||
    query.furnishing !== null ||
    query.parking !== null ||
    query.amenities.length > 0 ||
    query.sellerKind !== null ||
    query.verifiedOnly ||
    query.savedOnly
  );
}

/** How many filters are on, for the mobile drawer's badge. */
export function activeFilterCount(query: BrowseQuery): number {
  return activeFilterChips(query).length;
}

/**
 * One removable chip per active filter.
 *
 * `clear` is a patch to apply to the query, not a URL: the caller turns it into
 * one with `browseQueryString`, so a chip cannot get the base path wrong and an
 * amenity chip can remove itself from a list rather than clearing the list.
 */
export type FilterChip = {
  readonly id: string;
  readonly label: string;
  readonly clear: Partial<BrowseQuery>;
};

export function activeFilterChips(query: BrowseQuery): FilterChip[] {
  const chips: FilterChip[] = [];

  if (!query.intentLocked && query.intent !== null) {
    chips.push({
      id: "intent",
      label: query.intent === "BUY" ? "For sale" : "For rent",
      clear: { intent: null },
    });
  }

  if (query.q !== "") {
    chips.push({ id: "q", label: `“${query.q}”`, clear: { q: "" } });
  }

  if (query.propertyType !== null) {
    chips.push({
      id: "type",
      label: PROPERTY_TYPE_LABELS[query.propertyType],
      clear: { propertyType: null },
    });
  }

  if (query.minPrice !== null || query.maxPrice !== null) {
    chips.push({
      id: "price",
      label: rangeLabel(query.minPrice, query.maxPrice, formatPrice),
      clear: { minPrice: null, maxPrice: null },
    });
  }

  if (query.minBedrooms !== null) {
    chips.push({
      id: "beds",
      label: `${query.minBedrooms}+ BHK`,
      clear: { minBedrooms: null },
    });
  }

  if (query.minBathrooms !== null) {
    chips.push({
      id: "baths",
      label: `${query.minBathrooms}+ bath`,
      clear: { minBathrooms: null },
    });
  }

  if (query.minArea !== null || query.maxArea !== null) {
    chips.push({
      id: "area",
      label: rangeLabel(query.minArea, query.maxArea, (value) => formatArea(value, "SQFT")),
      clear: { minArea: null, maxArea: null },
    });
  }

  if (query.furnishing !== null) {
    chips.push({
      id: "furnishing",
      label: FURNISHING_LABELS[query.furnishing],
      clear: { furnishing: null },
    });
  }

  if (query.parking !== null) {
    chips.push({ id: "parking", label: PARKING_LABELS[query.parking], clear: { parking: null } });
  }

  for (const slug of query.amenities) {
    chips.push({
      id: `amenity:${slug}`,
      label: amenityLabel(slug),
      clear: { amenities: query.amenities.filter((entry) => entry !== slug) },
    });
  }

  if (query.sellerKind !== null) {
    chips.push({
      id: "seller",
      label: SELLER_KIND_PLURAL_LABELS[query.sellerKind],
      clear: { sellerKind: null },
    });
  }

  if (query.verifiedOnly) {
    chips.push({ id: "verified", label: "Verified only", clear: { verifiedOnly: false } });
  }

  if (query.savedOnly) {
    chips.push({ id: "saved", label: "Saved only", clear: { savedOnly: false } });
  }

  return chips;
}

function rangeLabel(
  min: number | null,
  max: number | null,
  format: (value: number) => string
): string {
  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`;
  if (min !== null) return `${format(min)}+`;
  return `Up to ${format(max as number)}`;
}

// ─────────────────────────────────────────────────────────────
// Writing a query back out
// ─────────────────────────────────────────────────────────────

/**
 * Serialise a query for a link, optionally patched.
 *
 * `overrides` is a `Partial<BrowseQuery>` rather than a hand-rolled set of named
 * options because every caller wants something different from it — pagination
 * patches `page`, the sort control patches `sort`, a filter chip clears one
 * field, the intent tabs set `intent`. One general patch means none of them can
 * accidentally drop a filter the visitor set, which is what building the string
 * from scratch at each call site kept doing.
 *
 * Defaults are omitted, so a freshly-loaded page is a bare path and the "did
 * they filter anything" question has a visible answer in the address bar.
 */
export function browseQueryString(
  query: BrowseQuery,
  overrides: Partial<BrowseQuery> = {}
): string {
  const merged: BrowseQuery = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (!merged.intentLocked && merged.intent !== null) {
    params.set(BROWSE_FIELDS.intent, merged.intent);
  }
  if (merged.q) params.set(BROWSE_FIELDS.q, merged.q);
  if (merged.propertyType) params.set(BROWSE_FIELDS.propertyType, merged.propertyType);
  if (merged.minPrice !== null) params.set(BROWSE_FIELDS.minPrice, String(merged.minPrice));
  if (merged.maxPrice !== null) params.set(BROWSE_FIELDS.maxPrice, String(merged.maxPrice));
  if (merged.minBedrooms !== null) {
    params.set(BROWSE_FIELDS.minBedrooms, String(merged.minBedrooms));
  }
  if (merged.minBathrooms !== null) {
    params.set(BROWSE_FIELDS.minBathrooms, String(merged.minBathrooms));
  }
  if (merged.minArea !== null) params.set(BROWSE_FIELDS.minArea, String(merged.minArea));
  if (merged.maxArea !== null) params.set(BROWSE_FIELDS.maxArea, String(merged.maxArea));
  if (merged.furnishing) params.set(BROWSE_FIELDS.furnishing, merged.furnishing);
  if (merged.parking) params.set(BROWSE_FIELDS.parking, merged.parking);
  for (const slug of merged.amenities) params.append(BROWSE_FIELDS.amenity, slug);
  if (merged.sellerKind) params.set(BROWSE_FIELDS.sellerKind, merged.sellerKind);
  if (merged.verifiedOnly) params.set(BROWSE_FIELDS.verifiedOnly, "1");
  if (merged.savedOnly) params.set(BROWSE_FIELDS.savedOnly, "1");
  if (merged.sort !== DEFAULT_SORT) params.set(BROWSE_FIELDS.sort, merged.sort);
  // Carried through every filter change, so switching to the map and then
  // narrowing the price range does not bounce the visitor back to the list.
  if (merged.view !== DEFAULT_VIEW) params.set(BROWSE_FIELDS.view, merged.view);
  if (merged.page > 1) params.set(BROWSE_FIELDS.page, String(merged.page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * A link that changes a filter, which therefore starts again at page one.
 *
 * Staying on page 9 while narrowing the result set is how a visitor lands on an
 * empty page that looks like a bug. Every filter mutation goes through here;
 * only pagination and the sort control use `browseQueryString` directly, and the
 * sort control passes `page: 1` itself.
 */
export function filterHref(
  basePath: string,
  query: BrowseQuery,
  overrides: Partial<BrowseQuery>
): string {
  return `${basePath}${browseQueryString(query, { ...overrides, page: 1 })}`;
}
