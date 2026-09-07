import { z } from "zod";

import type { Furnishing, ListingType, ParkingType, PropertyType } from "@prisma/client";

import { MAX_AREA_SQFT } from "@/lib/properties/area";
import {
  BROWSE_SORTS,
  MAX_PRICE,
  MAX_QUERY_LENGTH,
  type BrowseSort,
} from "@/lib/properties/browse-query";
import {
  AMENITY_SLUGS,
  FURNISHING_LABELS,
  LISTING_TYPE_LABELS,
  MAX_ROOM_COUNT,
  PARKING_LABELS,
  PROPERTY_TYPE_LABELS,
  SELLER_KINDS,
  isKnownAmenity,
  type SellerKind,
} from "@/lib/properties/constants";

/**
 * What the model is allowed to say, and the boundary where its answer stops
 * being text and becomes application data.
 *
 * ── The one rule this module enforces ───────────────────────────────────────
 *
 * **Every field here corresponds to a column that exists in
 * `prisma/schema.prisma` and a filter that already exists in
 * `lib/properties/browse-query.ts`.** There is no field for a railway distance,
 * a commute time, a neighbourhood score or a price trend, because there is no
 * column holding any of them. A model asked for JSON will happily produce
 * `"railwayDistanceKm": 0.8`; `z.object` strips unknown keys, so that value is
 * discarded here rather than becoming a filter over data the database does not
 * have.
 *
 * That is why the schema is written out field by field and never derived from a
 * loose record: adding a column to `Property` does not silently make it
 * AI-controllable, and adding a *concept* the model can name requires a
 * deliberate edit here plus somewhere for it to go in the query.
 *
 * ── Why enum values are derived from the label records ─────────────────────
 *
 * Same reasoning as `lib/validation/property.ts`: `PROPERTY_TYPE_LABELS` and
 * friends are `Record<PrismaEnum, string>` and therefore exhaustive by
 * construction, so the set of values the model may return cannot drift from the
 * set the database can store. A hallucinated `"PENTHOUSE_SUITE"` fails
 * validation instead of reaching a `where`.
 *
 * ── Why validation is strict here and lenient in `parseBrowseQuery` ────────
 *
 * `parseBrowseQuery` coerces, because it parses a URL that a stranger may have
 * mangled and the honest answer to `?beds=🐈` is "no bedroom filter". This
 * parses a *provider's* answer to a question we asked in a schema we supplied.
 * A reply that does not fit is a fault worth surfacing — the visitor is told the
 * assistant could not read their request, which is true, rather than being shown
 * results for a silently half-understood query.
 *
 * Client-safe: the Prisma import is type-only and nothing here reads the
 * environment, so the panel can render criteria chips without pulling a database
 * client or a credential into the browser bundle.
 */

// ─────────────────────────────────────────────────────────────
// Proximity: named, closed, and honestly unanswerable
// ─────────────────────────────────────────────────────────────

/**
 * Landmarks a visitor may reasonably ask to be near.
 *
 * **Nothing in this application can filter or rank by any of them**, and that is
 * the point of listing them anyway. "2BHK near Vikhroli station" is one of the
 * most ordinary property searches in India; silently dropping the second half
 * would leave the visitor believing it was applied. So the model is allowed to
 * name what was asked for, from this closed list, and the UI reports it as
 * *understood but not filterable* — see `PROXIMITY_LABELS` and the `unsupported`
 * notes in `lib/ai/property-search.ts`.
 *
 * A closed set rather than free text for two reasons. Arbitrary model-authored
 * strings would be echoed into the page, and there is no reason to render text
 * a provider invented. And a fixed set can be labelled, which free text cannot.
 *
 * Filling this in for real needs a distance provider — the seam is
 * `lib/maps/nearby.ts`, which ships with none, for exactly the reason repeated
 * here: a guessed distance is a claim about somebody's purchase decision.
 */
export const AI_PROXIMITY_KINDS = [
  "RAILWAY_STATION",
  "METRO_STATION",
  "BUS_STOP",
  "AIRPORT",
  "SCHOOL",
  "HOSPITAL",
  "MARKET",
  "OFFICE_HUB",
] as const;

export type AiProximityKind = (typeof AI_PROXIMITY_KINDS)[number];

export const PROXIMITY_LABELS: Record<AiProximityKind, string> = {
  RAILWAY_STATION: "Railway station",
  METRO_STATION: "Metro station",
  BUS_STOP: "Bus stop",
  AIRPORT: "Airport",
  SCHOOL: "School",
  HOSPITAL: "Hospital",
  MARKET: "Market",
  OFFICE_HUB: "Office hub",
};

// ─────────────────────────────────────────────────────────────
// Parking: "some parking" is a real request the enum cannot express
// ─────────────────────────────────────────────────────────────

/**
 * What the model may say about parking.
 *
 * `ParkingType` describes what a listing *has* — none, open, covered, or both —
 * and every member is an exclusive description. "with parking", the way people
 * actually phrase it, is none of those: it is "not NONE". `"ANY"` is that
 * request, and it exists here rather than in `ParkingType` because the enum is
 * also the write vocabulary — adding a member there would let a seller store
 * "any" as a listing's parking, which is not a fact about a property.
 *
 * `lib/ai/merge.ts` turns `"ANY"` into an extra predicate on the browse query;
 * the four real members map straight onto the existing `parking` filter, whose
 * OPEN/COVERED-also-match-BOTH behaviour is preserved.
 */
export const AI_PARKING_VALUES = ["ANY", ...(Object.keys(PARKING_LABELS) as ParkingType[])] as const;

export type AiParking = "ANY" | ParkingType;

export const AI_PARKING_LABELS: Record<AiParking, string> = {
  ANY: "Parking (any kind)",
  ...PARKING_LABELS,
};

// ─────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────

/**
 * Sorts the model may ask for.
 *
 * `ai-match` is excluded, and not by accident: `lib/properties/ai.ts` withholds
 * that option until a `MatchScorer` is installed, and none is. Letting the model
 * request a sort the application refuses to offer would put the lie back exactly
 * where that module removed it. Match ordering is delivered by the assistant
 * panel, which has real criteria to score against; the browse dropdown does not.
 */
export const AI_SORTS = BROWSE_SORTS.filter((sort) => sort !== "ai-match");

// ─────────────────────────────────────────────────────────────
// The criteria
// ─────────────────────────────────────────────────────────────

/**
 * The structured form of a natural-language property request.
 *
 * Every field is nullable and every one defaults to null, because "the visitor
 * did not say" is the common case and must not be confused with a value. A model
 * that guesses a budget nobody mentioned narrows the result set for reasons the
 * visitor cannot see.
 */
export type AiCriteria = {
  readonly listingType: ListingType | null;
  readonly propertyType: PropertyType | null;

  /** Read as "at least this many", matching the existing `beds`/`baths`
   *  filters — a 3BHK satisfies a request for 2. Scoring distinguishes an exact
   *  match from a larger one; the filter does not. */
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;

  readonly minPrice: number | null;
  readonly maxPrice: number | null;

  /**
   * A place name as the visitor said it — "Vikhroli", "Powai", "Bengaluru".
   *
   * One field rather than separate city/locality/pincode fields, because that is
   * what the existing search clause already answers: `searchClause` matches
   * locality, city, state and pincode at once, so asking the model to decide
   * which of them "Vikhroli" is would add a guess with no benefit and one more
   * way to be wrong.
   */
  readonly location: string | null;

  readonly furnishing: Furnishing | null;
  readonly parking: AiParking | null;

  /** Allowlisted slugs only; anything else is dropped by `normaliseAiCriteria`. */
  readonly amenities: readonly string[];

  /** Square feet, the one scale the area filter works in. See lib/properties/area.ts. */
  readonly minArea: number | null;
  readonly maxArea: number | null;

  readonly sellerKind: SellerKind | null;
  readonly verifiedOnly: boolean;

  readonly sort: BrowseSort | null;

  /** Named, understood, and not filterable. See `AI_PROXIMITY_KINDS`. */
  readonly proximity: readonly AiProximityKind[];
};

/** Nothing asked for. The starting point of a conversation, and the value a
 *  cleared search returns to. */
export const EMPTY_AI_CRITERIA: AiCriteria = {
  listingType: null,
  propertyType: null,
  bedrooms: null,
  bathrooms: null,
  minPrice: null,
  maxPrice: null,
  location: null,
  furnishing: null,
  parking: null,
  amenities: [],
  minArea: null,
  maxArea: null,
  sellerKind: null,
  verifiedOnly: false,
  sort: null,
  proximity: [],
};

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

/**
 * `null`, `undefined` and `""` all mean "not specified".
 *
 * Models are inconsistent about which of the three they emit for an absent
 * value, and all three are the same answer. Normalising before the type check
 * means a reply that omits half the keys is valid rather than a hard failure the
 * visitor sees as "the assistant could not read that".
 */
const absent = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "")
    ? undefined
    : value;

function nullableEnum<T extends string>(labels: Record<T, string>) {
  const values = Object.keys(labels) as [T, ...T[]];
  return z.preprocess(absent, z.enum(values).optional());
}

/** A whole number in range, or nothing. Non-integers are refused rather than
 *  rounded: "2.5 bedrooms" is a misreading, not a number to salvage. */
const nullableCount = (min: number, max: number) =>
  z.preprocess(absent, z.number().int().min(min).max(max).optional());

/** A finite positive amount, capped at the same ceiling the URL parser uses. */
const nullableAmount = (max: number) =>
  z.preprocess(absent, z.number().finite().positive().max(max).optional());

/**
 * The characters a place name may contain.
 *
 * Deliberately the same policy as the browse search box (`SEARCH_DISALLOWED` in
 * browse-query.ts): letters and digits in any script plus the punctuation that
 * appears in Indian place names, everything else replaced with a space. The
 * value ends up in a `contains` filter and in the page, so it is sanitised on
 * the way in rather than trusted because a model produced it — a provider is an
 * untrusted input source like any other.
 */
const PLACE_DISALLOWED = /[^\p{L}\p{N} ,.'&/#-]+/gu;

const nullablePlace = z.preprocess(
  absent,
  z
    .string()
    .transform((value) =>
      value
        .replace(/\s+/g, " ")
        .replace(PLACE_DISALLOWED, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_QUERY_LENGTH)
    )
    .optional()
);

/**
 * The wire schema.
 *
 * `z.object` strips unknown keys, so an invented field is discarded silently and
 * a *malformed known* field is a hard error. That asymmetry is deliberate:
 * inventing a key is the model being chatty, while sending `bedrooms: "a few"`
 * means it did not understand the request, and pretending otherwise would search
 * for something the visitor did not ask for.
 */
export const aiCriteriaSchema = z.object({
  listingType: nullableEnum(LISTING_TYPE_LABELS),
  propertyType: nullableEnum(PROPERTY_TYPE_LABELS),

  bedrooms: nullableCount(1, MAX_ROOM_COUNT),
  bathrooms: nullableCount(1, MAX_ROOM_COUNT),

  minPrice: nullableAmount(MAX_PRICE),
  maxPrice: nullableAmount(MAX_PRICE),

  location: nullablePlace,

  furnishing: nullableEnum(FURNISHING_LABELS),
  parking: z.preprocess(absent, z.enum(AI_PARKING_VALUES).optional()),

  // Unknown slugs are filtered — not refused — by `normaliseAiCriteria`, which
  // reports what it dropped so the visitor is told rather than left guessing.
  amenities: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(z.string()).max(64).default([])
  ),

  minArea: nullableAmount(MAX_AREA_SQFT),
  maxArea: nullableAmount(MAX_AREA_SQFT),

  sellerKind: z.preprocess(absent, z.enum(SELLER_KINDS).optional()),
  verifiedOnly: z.preprocess(
    (value) => (value === null || value === undefined ? false : value),
    z.boolean().default(false)
  ),

  sort: z.preprocess(absent, z.enum(AI_SORTS as [BrowseSort, ...BrowseSort[]]).optional()),

  proximity: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(z.enum(AI_PROXIMITY_KINDS)).max(AI_PROXIMITY_KINDS.length).default([])
  ),
});

export type AiCriteriaInput = z.infer<typeof aiCriteriaSchema>;

/**
 * What a validated reply had to have thrown away.
 *
 * Surfaced to the visitor rather than swallowed: someone who asked for "24x7
 * water" and got results filtered by nothing of the sort deserves to know which
 * half of their sentence the marketplace could not act on.
 */
export type AiCriteriaNormalisation = {
  readonly criteria: AiCriteria;
  /** Amenity names the model produced that are not on the allowlist. */
  readonly droppedAmenities: readonly string[];
};

/**
 * Validated input → the application's own criteria type.
 *
 * Two jobs beyond the type change. Amenity slugs are filtered against the
 * allowlist, because a model will confidently produce `"24x7-water"` for a slug
 * that is spelled `"water-supply-24x7"`, and a `hasEvery` filter on a slug no
 * row carries is an empty result set with no explanation. And an inverted range
 * is dropped from the top rather than swapped — the same decision
 * `parseBrowseQuery` makes, for the same reason: swapping answers a question
 * nobody asked.
 */
export function normaliseAiCriteria(input: AiCriteriaInput): AiCriteriaNormalisation {
  const requested = [...new Set(input.amenities.map((slug) => slug.trim().toLowerCase()))];
  const amenities = requested.filter(isKnownAmenity).sort();
  const droppedAmenities = requested.filter((slug) => !isKnownAmenity(slug));

  const minPrice = input.minPrice ?? null;
  const maxPrice = input.maxPrice ?? null;
  const minArea = input.minArea ?? null;
  const maxArea = input.maxArea ?? null;

  return {
    criteria: {
      listingType: (input.listingType as ListingType | undefined) ?? null,
      propertyType: (input.propertyType as PropertyType | undefined) ?? null,

      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,

      minPrice,
      maxPrice: maxPrice !== null && minPrice !== null && maxPrice < minPrice ? null : maxPrice,

      location: input.location && input.location.length > 0 ? input.location : null,

      furnishing: (input.furnishing as Furnishing | undefined) ?? null,
      parking: (input.parking as AiParking | undefined) ?? null,

      amenities: amenities.slice(0, AMENITY_SLUGS.length),

      minArea,
      maxArea: maxArea !== null && minArea !== null && maxArea < minArea ? null : maxArea,

      sellerKind: (input.sellerKind as SellerKind | undefined) ?? null,
      verifiedOnly: input.verifiedOnly,

      sort: (input.sort as BrowseSort | undefined) ?? null,

      proximity: [...new Set(input.proximity as AiProximityKind[])],
    },
    droppedAmenities,
  };
}

/** True when the model extracted nothing at all — an empty result is then a
 *  statement about the *question*, not about the inventory. */
export function isEmptyAiCriteria(criteria: AiCriteria): boolean {
  return (
    criteria.listingType === null &&
    criteria.propertyType === null &&
    criteria.bedrooms === null &&
    criteria.bathrooms === null &&
    criteria.minPrice === null &&
    criteria.maxPrice === null &&
    criteria.location === null &&
    criteria.furnishing === null &&
    criteria.parking === null &&
    criteria.amenities.length === 0 &&
    criteria.minArea === null &&
    criteria.maxArea === null &&
    criteria.sellerKind === null &&
    !criteria.verifiedOnly &&
    criteria.sort === null &&
    criteria.proximity.length === 0
  );
}

// ─────────────────────────────────────────────────────────────
// The contract handed to the provider
// ─────────────────────────────────────────────────────────────

/**
 * The JSON Schema sent to providers that support structured output.
 *
 * Built from the same label records the Zod schema is built from, so the two
 * cannot describe different value sets — a provider constrained to one vocabulary
 * and validated against another would fail intermittently and look like a model
 * problem. `tests/unit/ai-criteria.test.ts` asserts the two agree key for key.
 *
 * `additionalProperties: false` asks the provider to withhold invented fields at
 * the source. Zod strips them anyway; this just saves a round trip.
 */
export function aiCriteriaJsonSchema(): Record<string, unknown> {
  const nullableString = (values: readonly string[]) => ({
    type: ["string", "null"],
    enum: [...values, null],
  });
  const nullableInteger = (minimum: number, maximum: number) => ({
    type: ["integer", "null"],
    minimum,
    maximum,
  });
  const nullableNumber = (maximum: number) => ({
    type: ["number", "null"],
    exclusiveMinimum: 0,
    maximum,
  });

  const properties: Record<string, unknown> = {
    listingType: nullableString(Object.keys(LISTING_TYPE_LABELS)),
    propertyType: nullableString(Object.keys(PROPERTY_TYPE_LABELS)),
    bedrooms: nullableInteger(1, MAX_ROOM_COUNT),
    bathrooms: nullableInteger(1, MAX_ROOM_COUNT),
    minPrice: nullableNumber(MAX_PRICE),
    maxPrice: nullableNumber(MAX_PRICE),
    location: { type: ["string", "null"], maxLength: MAX_QUERY_LENGTH },
    furnishing: nullableString(Object.keys(FURNISHING_LABELS)),
    parking: nullableString(AI_PARKING_VALUES),
    amenities: { type: "array", items: { type: "string", enum: [...AMENITY_SLUGS] } },
    minArea: nullableNumber(MAX_AREA_SQFT),
    maxArea: nullableNumber(MAX_AREA_SQFT),
    sellerKind: nullableString(SELLER_KINDS),
    verifiedOnly: { type: "boolean" },
    sort: nullableString(AI_SORTS),
    proximity: { type: "array", items: { type: "string", enum: [...AI_PROXIMITY_KINDS] } },
  };

  return {
    type: "object",
    properties,
    // Every key required, with null as the "not specified" value. A provider
    // that may omit keys tends to omit the ones it is least sure about, which is
    // precisely where an explicit null is most informative.
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
