import type { PublicListing } from "@/types";

import { toSqft } from "@/lib/properties/area";
import {
  AMENITY_SLUGS,
  FURNISHING_LABELS,
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  amenityLabel,
} from "@/lib/properties/constants";
import { formatArea, formatPrice } from "@/lib/properties/format";

import { AI_PARKING_LABELS, PROXIMITY_LABELS, type AiCriteria } from "./criteria";

/**
 * The match score, and why no model is asked to produce one.
 *
 * ── Deterministic, and therefore checkable ──────────────────────────────────
 *
 * A percentage next to a property is a claim, and the person reading it will act
 * on it. Asking a model for "94" produces a number with no derivation: it cannot
 * be reproduced, it cannot be audited against the row it describes, and it will
 * differ between two calls about the same listing. Everything below is a pure
 * function of one `PublicListing` and one `AiCriteria` — the same inputs give
 * the same score forever, every factor is shown with the value it came from, and
 * `tests/unit/ai-match.test.ts` asserts the arithmetic.
 *
 * The model's job ends at understanding the sentence. Scoring is arithmetic, and
 * arithmetic is not a language problem.
 *
 * ── Unknown is not a match, and not a miss either ──────────────────────────
 *
 * Most nullable columns on `Property` are genuinely optional — `parking`,
 * `furnishing`, `bathrooms` and `bedrooms` are all null on real rows. Three ways
 * to handle a criterion whose column is null, and two are wrong:
 *
 *   - Count it as a match: the score claims a parking space that may not exist.
 *   - Count it as a miss: a listing is punished for its seller's incomplete form,
 *     and a well-described listing with no parking outranks an undescribed one
 *     that has it.
 *   - **Exclude it from the score and show it as `—`.** The percentage is then
 *     "of what could be checked, this much fits", which is a statement the data
 *     supports.
 *
 * The third is what happens. `MatchStatus` has a fourth member for it, the
 * denominator only counts factors that were actually decided, and a listing
 * where nothing could be decided scores `null` rather than 0 or 100 — the UI
 * shows "not enough data to score" instead of a number.
 *
 * ── What the explanation may say ───────────────────────────────────────────
 *
 * Every sentence is assembled from a field that was read off the row. There is
 * no template that can produce "5 minutes from the station", because no column
 * holds a distance or a travel time; the strongest thing that can be said about
 * a place is "Located in Vikhroli, Mumbai", which is what `locality` and `city`
 * actually contain. See `AI_PROXIMITY_KINDS` for the same argument at the
 * criteria end.
 *
 * Client-safe: pure, no Prisma runtime, no `server-only`, so the panel renders
 * the same factors the server computed rather than a second opinion.
 */

// ─────────────────────────────────────────────────────────────
// Factors
// ─────────────────────────────────────────────────────────────

/**
 * `—` in the UI is `unknown`, and it is the member that carries the design.
 * `partial` covers "satisfies the requirement but not exactly" — a 3BHK for a
 * 2BHK request, two of three amenities — which is real information that a
 * yes/no would throw away.
 */
export type MatchStatus = "match" | "partial" | "miss" | "unknown";

export type MatchFactorId =
  | "budget"
  | "location"
  | "bedrooms"
  | "propertyType"
  | "listingType"
  | "parking"
  | "amenities"
  | "bathrooms"
  | "area"
  | "furnishing"
  | "verified"
  | "proximity";

export type MatchFactor = {
  readonly id: string;
  readonly kind: MatchFactorId;
  /** Row label: "Budget", "Location", "Railway station". */
  readonly label: string;
  readonly status: MatchStatus;
  /** One clause describing the listing's actual value. Never a claim beyond it. */
  readonly detail: string;
};

/**
 * How much each factor counts, before normalisation.
 *
 * Roughly the weighting a buyer describes when asked what matters — budget and
 * location first, configuration next, everything else a tie-breaker — but the
 * absolute numbers matter far less than they look, because the denominator is
 * recomputed per listing from the factors that could actually be decided. A
 * listing with no parking data is scored on the remaining weight, not penalised
 * by ten points of missing information.
 *
 * `proximity` is weighted 0 and is always `unknown`: it is shown so the visitor
 * can see their request was read, and it can never move a number that no data
 * supports.
 */
const WEIGHTS: Record<MatchFactorId, number> = {
  budget: 25,
  location: 25,
  bedrooms: 20,
  propertyType: 10,
  parking: 10,
  amenities: 10,
  bathrooms: 8,
  area: 8,
  furnishing: 6,
  listingType: 6,
  verified: 5,
  proximity: 0,
};

const STATUS_VALUE: Record<MatchStatus, number> = {
  match: 1,
  partial: 0.5,
  miss: 0,
  // Never used — unknown factors are removed before the sum — but present so
  // the record is exhaustive and a new status cannot be added without deciding.
  unknown: 0,
};

export type MatchResult = {
  readonly propertyId: string;
  /** 0–100, or `null` when no criterion could be checked against this row. */
  readonly score: number | null;
  readonly factors: readonly MatchFactor[];
  /** Hedged headline — "Strong match based on the available property data." */
  readonly summary: string;
  /** Sentences built only from fields read off the listing. */
  readonly explanation: string;
  /** What could not be checked, and why. Rendered under the factor list. */
  readonly caveats: readonly string[];
};

// ─────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────

type ScoredFactor = MatchFactor & {
  /** Overrides `STATUS_VALUE` where a factor is genuinely graded — amenities. */
  readonly value?: number;
};

function contains(haystack: string | null, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

/**
 * Score one listing against one set of criteria.
 *
 * Only criteria the visitor actually stated produce a factor. A search that
 * mentioned nothing but a budget is scored on the budget, and the panel shows a
 * one-row breakdown — honest, and visibly so, rather than a 100% built from ten
 * criteria nobody expressed.
 */
export function scoreListing(listing: PublicListing, criteria: AiCriteria): MatchResult {
  const factors: ScoredFactor[] = [];

  // ── Budget. `price` is required on every row, so this is always decidable.
  if (criteria.minPrice !== null || criteria.maxPrice !== null) {
    const overMax = criteria.maxPrice !== null && listing.price > criteria.maxPrice;
    const underMin = criteria.minPrice !== null && listing.price < criteria.minPrice;

    factors.push({
      id: "budget",
      kind: "budget",
      label: "Budget",
      status: overMax || underMin ? "miss" : "match",
      detail: overMax
        ? `${formatPrice(listing.price)} is above your ${formatPrice(criteria.maxPrice as number)} limit`
        : underMin
          ? `${formatPrice(listing.price)} is below the ${formatPrice(criteria.minPrice as number)} minimum you set`
          : `${formatPrice(listing.price)}${listing.listingType === "RENT" ? " per month" : ""}, within your budget`,
    });
  }

  // ── Location. Locality and city are the strongest evidence the public
  // projection carries; a title mention is weaker and is graded as such rather
  // than counted the same.
  if (criteria.location !== null) {
    const needle = criteria.location.toLowerCase();
    const inLocality = contains(listing.locality, needle);
    const inCity = contains(listing.city, needle);
    const inState = contains(listing.state, needle);
    const inTitle = contains(listing.title, needle);
    const place = listing.locality ? `${listing.locality}, ${listing.city}` : listing.city;

    factors.push({
      id: "location",
      kind: "location",
      label: "Location",
      status: inLocality || inCity ? "match" : inState || inTitle ? "partial" : "miss",
      detail:
        inLocality || inCity
          ? `Located in ${place}`
          : inState
            ? `In ${listing.state}, but ${place} rather than ${criteria.location}`
            : inTitle
              ? `The listing names ${criteria.location}, and is located in ${place}`
              : `Located in ${place}, not ${criteria.location}`,
    });
  }

  // ── Bedrooms. Null on every land and commercial row by design (see
  // ROOM_BEARING_TYPES), and on residential rows written before the field was
  // required — so unknown is a live case, not a defensive branch.
  if (criteria.bedrooms !== null) {
    const beds = listing.bedrooms;
    factors.push({
      id: "bedrooms",
      kind: "bedrooms",
      label: "Bedrooms",
      status:
        beds === null
          ? "unknown"
          : beds === criteria.bedrooms
            ? "match"
            : beds > criteria.bedrooms
              ? "partial"
              : "miss",
      detail:
        beds === null
          ? "This listing does not state a bedroom count"
          : beds === criteria.bedrooms
            ? `${beds} BHK, as asked`
            : beds > criteria.bedrooms
              ? `${beds} BHK — larger than the ${criteria.bedrooms} you asked for`
              : `${beds} BHK, fewer than the ${criteria.bedrooms} you asked for`,
    });
  }

  if (criteria.bathrooms !== null) {
    const baths = listing.bathrooms;
    factors.push({
      id: "bathrooms",
      kind: "bathrooms",
      label: "Bathrooms",
      status:
        baths === null
          ? "unknown"
          : baths === criteria.bathrooms
            ? "match"
            : baths > criteria.bathrooms
              ? "partial"
              : "miss",
      detail:
        baths === null
          ? "This listing does not state a bathroom count"
          : `${baths} ${baths === 1 ? "bathroom" : "bathrooms"}`,
    });
  }

  if (criteria.propertyType !== null) {
    const same = listing.propertyType === criteria.propertyType;
    factors.push({
      id: "propertyType",
      kind: "propertyType",
      label: "Property type",
      status: same ? "match" : "miss",
      detail: same
        ? PROPERTY_TYPE_LABELS[listing.propertyType]
        : `${PROPERTY_TYPE_LABELS[listing.propertyType]}, not ${PROPERTY_TYPE_LABELS[criteria.propertyType]}`,
    });
  }

  if (criteria.listingType !== null) {
    const same = listing.listingType === criteria.listingType;
    factors.push({
      id: "listingType",
      kind: "listingType",
      label: "Buy / rent",
      status: same ? "match" : "miss",
      detail: LISTING_TYPE_LABELS[listing.listingType],
    });
  }

  // ── Parking. The one place where "the column is null" is most likely, and the
  // one the brief calls out: no parking information must never read as "yes".
  if (criteria.parking !== null) {
    factors.push(parkingFactor(listing, criteria));
  }

  // ── Amenities, graded. An empty array is treated as unknown rather than as a
  // miss: `amenities` defaults to `[]`, so "the seller listed none" and "the
  // seller filled nothing in" are the same stored value, and punishing a listing
  // for the ambiguity would be reading more than the column says.
  if (criteria.amenities.length > 0) {
    const listed = new Set(listing.amenities);
    const present = criteria.amenities.filter((slug) => listed.has(slug));
    const missing = criteria.amenities.filter((slug) => !listed.has(slug));

    factors.push({
      id: "amenities",
      kind: "amenities",
      label: criteria.amenities.length === 1 ? amenityLabel(criteria.amenities[0]) : "Amenities",
      status:
        listing.amenities.length === 0
          ? "unknown"
          : present.length === criteria.amenities.length
            ? "match"
            : present.length > 0
              ? "partial"
              : "miss",
      value: present.length / criteria.amenities.length,
      detail:
        listing.amenities.length === 0
          ? "This listing does not list its amenities"
          : missing.length === 0
            ? `Lists ${present.map(amenityLabel).join(", ").toLowerCase()}`
            : present.length > 0
              ? `Lists ${present.map(amenityLabel).join(", ").toLowerCase()}; does not list ${missing.map(amenityLabel).join(", ").toLowerCase()}`
              : `Does not list ${missing.map(amenityLabel).join(", ").toLowerCase()}`,
    });
  }

  // ── Area. `areaValue`/`areaUnit` are required columns, so this is always
  // decidable — but only after converting the row into the scale the request was
  // made in. See lib/properties/area.ts for why the threshold moves, not the row.
  if (criteria.minArea !== null || criteria.maxArea !== null) {
    const sqft = toSqft(listing.areaValue, listing.areaUnit);
    const overMax = criteria.maxArea !== null && sqft > criteria.maxArea;
    const underMin = criteria.minArea !== null && sqft < criteria.minArea;

    factors.push({
      id: "area",
      kind: "area",
      label: "Area",
      status: overMax || underMin ? "miss" : "match",
      detail: `${formatArea(listing.areaValue, listing.areaUnit)}${
        listing.areaUnit === "SQFT" ? "" : ` (about ${formatArea(Math.round(sqft), "SQFT")})`
      }`,
    });
  }

  if (criteria.furnishing !== null) {
    const furnishing = listing.furnishing;
    factors.push({
      id: "furnishing",
      kind: "furnishing",
      label: "Furnishing",
      status:
        furnishing === null ? "unknown" : furnishing === criteria.furnishing ? "match" : "miss",
      detail:
        furnishing === null
          ? "This listing does not state its furnishing"
          : FURNISHING_LABELS[furnishing],
    });
  }

  if (criteria.verifiedOnly) {
    factors.push({
      id: "verified",
      kind: "verified",
      label: "Verified",
      status: listing.verified ? "match" : "miss",
      detail: listing.verified
        ? "Verified by PROPERTYNEX"
        : "Published, but not PROPERTYNEX-verified",
    });
  }

  // ── Proximity. Always unknown, weighted zero, and shown anyway — see the
  // module header and `AI_PROXIMITY_KINDS`.
  for (const kind of criteria.proximity) {
    factors.push({
      id: `proximity:${kind}`,
      kind: "proximity",
      label: PROXIMITY_LABELS[kind],
      status: "unknown",
      detail: "No listing on PROPERTYNEX records a distance to this",
    });
  }

  return {
    propertyId: listing.id,
    score: computeScore(factors),
    factors: factors.map(({ value: _value, ...factor }) => factor),
    summary: summarise(computeScore(factors)),
    explanation: explain(factors),
    caveats: factors
      .filter((factor) => factor.status === "unknown")
      .map((factor) => `${factor.label}: ${factor.detail.toLowerCase()}.`),
  };
}

function parkingFactor(listing: PublicListing, criteria: AiCriteria): ScoredFactor {
  const wanted = criteria.parking as NonNullable<AiCriteria["parking"]>;
  const actual = listing.parking;

  if (actual === null) {
    return {
      id: "parking",
      kind: "parking",
      label: "Parking",
      status: "unknown",
      // The exact wording the brief asks for: unknown, stated as unknown.
      detail: "This listing does not state whether it has parking",
    };
  }

  // "Any parking" is satisfied by every affirmative member and by nothing else.
  if (wanted === "ANY") {
    return {
      id: "parking",
      kind: "parking",
      label: "Parking",
      status: actual === "NONE" ? "miss" : "match",
      detail:
        actual === "NONE"
          ? "The listing states there is no parking"
          : `${AI_PARKING_LABELS[actual]} according to the listing`,
    };
  }

  // BOTH satisfies a request for OPEN or COVERED — the same expansion
  // `buildBrowseWhere` applies, so the filter and the score cannot disagree.
  const satisfied =
    actual === wanted || ((wanted === "OPEN" || wanted === "COVERED") && actual === "BOTH");
  // Asking for both kinds and getting one is genuinely halfway there.
  const halfway = wanted === "BOTH" && (actual === "OPEN" || actual === "COVERED");

  return {
    id: "parking",
    kind: "parking",
    label: "Parking",
    status: satisfied ? "match" : halfway ? "partial" : "miss",
    detail: `${AI_PARKING_LABELS[actual]} according to the listing`,
  };
}

/**
 * Weighted mean over the factors that could be decided.
 *
 * `null` when nothing could — which is a different answer from 0% and is
 * rendered differently. A listing that matches nothing scores 0; a listing whose
 * every relevant column is empty has no score at all.
 */
function computeScore(factors: readonly ScoredFactor[]): number | null {
  let earned = 0;
  let available = 0;

  for (const factor of factors) {
    if (factor.status === "unknown") continue;
    const weight = WEIGHTS[factor.kind];
    if (weight === 0) continue;

    available += weight;
    earned += weight * (factor.value ?? STATUS_VALUE[factor.status]);
  }

  if (available === 0) return null;
  return Math.round((earned / available) * 100);
}

/**
 * The headline, hedged on purpose.
 *
 * Every phrase ends in "based on the available property data" or names the
 * shortfall. None of them says a property is the right one — the score describes
 * a fit between a sentence and a row, and a home is not bought on that.
 */
function summarise(score: number | null): string {
  if (score === null) return "Not enough listing data to score this against your request.";
  if (score >= 85) return "Strong match based on the available property data.";
  if (score >= 65) return "Good match based on the available property data.";
  if (score >= 40) return "Partial match — some of your requirements are not met.";
  return "Weak match — most of your requirements are not met.";
}

/** How many clauses one explanation may carry before it stops being read. */
const MAX_EXPLANATION_CLAUSES = 3;

/**
 * The explanation, assembled from factor details.
 *
 * Positives first, because they are why the listing is being shown, then the
 * most important shortfall — a paragraph of everything wrong with a listing is
 * not an explanation, and hiding the shortfall entirely is not one either.
 */
function explain(factors: readonly ScoredFactor[]): string {
  const good = factors
    .filter((factor) => factor.status === "match" || factor.status === "partial")
    .sort((a, b) => WEIGHTS[b.kind] - WEIGHTS[a.kind])
    .slice(0, MAX_EXPLANATION_CLAUSES)
    .map((factor) => factor.detail);

  const bad = factors
    .filter((factor) => factor.status === "miss")
    .sort((a, b) => WEIGHTS[b.kind] - WEIGHTS[a.kind])
    .slice(0, 1)
    .map((factor) => factor.detail);

  const parts = [...good, ...bad];
  if (parts.length === 0) return "Nothing in your request could be checked against this listing.";

  return `${parts.join(". ")}.`;
}

// ─────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────

export type ScoredListing = {
  readonly listing: PublicListing;
  readonly match: MatchResult;
};

/**
 * Score a page of listings and order them best-first.
 *
 * Unscoreable listings (`score === null`) sink to the bottom rather than being
 * dropped: they are real live listings that came back from a real query, and
 * removing them because their sellers left fields empty would be the assistant
 * hiding inventory. The tiebreak is the order the database returned, which is
 * already deterministic — `browseOrderBy` ends every sort with a unique key.
 */
export function scoreListings(
  listings: readonly PublicListing[],
  criteria: AiCriteria
): ScoredListing[] {
  return listings
    .map((listing, index) => ({ listing, match: scoreListing(listing, criteria), index }))
    .sort((a, b) => {
      const left = a.match.score;
      const right = b.match.score;
      if (left === right) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      if (right !== left) return right - left;
      return a.index - b.index;
    })
    .map(({ listing, match }) => ({ listing, match }));
}

/** Sanity bound used by the tests: the weights must cover every factor id. */
export const MATCH_FACTOR_IDS = Object.keys(WEIGHTS) as MatchFactorId[];

/** Re-exported so a test can assert the amenity allowlist is what scoring reads. */
export const SCOREABLE_AMENITIES = AMENITY_SLUGS;
