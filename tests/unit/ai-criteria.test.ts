import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_PARKING_VALUES,
  AI_PROXIMITY_KINDS,
  AI_SORTS,
  aiCriteriaJsonSchema,
  aiCriteriaSchema,
  isEmptyAiCriteria,
  normaliseAiCriteria,
  EMPTY_AI_CRITERIA,
} from "../../lib/ai/criteria";
import { AMENITY_SLUGS, MAX_ROOM_COUNT } from "../../lib/properties/constants";
import { BROWSE_SORTS } from "../../lib/properties/browse-query";

/**
 * The boundary where a model's answer stops being text.
 *
 * ── What these tests are, and what they are not ─────────────────────────────
 *
 * They do NOT test that a model extracts "80 lakh" correctly — nothing here
 * calls a provider, and a test that asserted it against a stub would be
 * asserting the stub. What they test is the half that is deterministic and is
 * the half that carries the safety argument: **given** a reply, what is allowed
 * through and what is refused.
 *
 * Whether the model reads the sentence correctly is an integration question,
 * answered by an actual provider request and reported as such — see README §10.
 */

/** A reply with every field explicitly null, which is what the schema asks for. */
function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}) {
  const validated = aiCriteriaSchema.parse(reply(overrides));
  return normaliseAiCriteria(validated);
}

// ─────────────────────────────────────────────────────────────
// The worked example from the brief
// ─────────────────────────────────────────────────────────────

test("the brief's worked example survives validation intact", () => {
  // "I want a 2BHK under 80 lakh near Vikhroli with parking and close to
  // railway station." — the criteria a model is asked to produce for it.
  const { criteria } = parse({
    propertyType: "APARTMENT",
    bedrooms: 2,
    maxPrice: 8_000_000,
    location: "Vikhroli",
    parking: "ANY",
    proximity: ["RAILWAY_STATION"],
  });

  assert.equal(criteria.propertyType, "APARTMENT");
  assert.equal(criteria.bedrooms, 2);
  assert.equal(criteria.maxPrice, 8_000_000);
  assert.equal(criteria.location, "Vikhroli");
  assert.equal(criteria.parking, "ANY");
  assert.deepEqual([...criteria.proximity], ["RAILWAY_STATION"]);

  // Everything not asked for stays null. A model that guessed a city or a
  // minimum price would narrow the search invisibly.
  assert.equal(criteria.minPrice, null);
  assert.equal(criteria.listingType, null);
  assert.equal(criteria.furnishing, null);
  assert.equal(criteria.bathrooms, null);
});

// ─────────────────────────────────────────────────────────────
// Invented fields and invented values
// ─────────────────────────────────────────────────────────────

test("a field the schema does not define is discarded, not stored", () => {
  // The central claim. A model asked for property criteria will readily produce
  // a distance, a score or a commute time — none of which any column holds.
  const validated = aiCriteriaSchema.parse(
    reply({
      railwayDistanceKm: 0.8,
      commuteMinutes: 12,
      neighbourhoodScore: 8.4,
      pricePerSqft: 14500,
      __proto__: { polluted: true },
    })
  );

  assert.equal("railwayDistanceKm" in validated, false);
  assert.equal("commuteMinutes" in validated, false);
  assert.equal("neighbourhoodScore" in validated, false);
  assert.equal("pricePerSqft" in validated, false);
  assert.equal(
    (Object.prototype as unknown as { polluted?: unknown }).polluted,
    undefined,
    "prototype pollution reached Object.prototype"
  );
});

test("an enum value that is not in the database's vocabulary is refused", () => {
  // A hallucinated member must fail here rather than reach a `where` as a value
  // no row can hold.
  for (const propertyType of ["PENTHOUSE_SUITE", "DUPLEX", "apartment", "Flat", ""]) {
    const result = aiCriteriaSchema.safeParse(reply({ propertyType }));
    assert.equal(result.success, propertyType === "", `accepted propertyType=${propertyType}`);
  }

  assert.equal(aiCriteriaSchema.safeParse(reply({ listingType: "LEASE" })).success, false);
  assert.equal(aiCriteriaSchema.safeParse(reply({ furnishing: "PART_FURNISHED" })).success, false);
  assert.equal(aiCriteriaSchema.safeParse(reply({ sellerKind: "broker" })).success, false);
  assert.equal(aiCriteriaSchema.safeParse(reply({ parking: "GARAGE" })).success, false);
  assert.equal(aiCriteriaSchema.safeParse(reply({ proximity: ["BEACH"] })).success, false);
});

test("a non-numeric answer to a numeric question is a hard failure", () => {
  // "the model did not understand" is a different outcome from "the visitor did
  // not say", and only the second is a null. Salvaging "a few" as 3 would search
  // for something nobody asked for.
  for (const bedrooms of ["two", "a few", 2.5, -1, 0, MAX_ROOM_COUNT + 1, true]) {
    assert.equal(
      aiCriteriaSchema.safeParse(reply({ bedrooms })).success,
      false,
      `accepted bedrooms=${String(bedrooms)}`
    );
  }

  for (const maxPrice of ["80 lakh", "8000000", 0, -5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(
      aiCriteriaSchema.safeParse(reply({ maxPrice })).success,
      false,
      `accepted maxPrice=${String(maxPrice)}`
    );
  }
});

test("null, undefined and empty string all mean “not specified”", () => {
  // Models are inconsistent about which they emit, and all three are the same
  // answer. A reply that omits keys entirely must still validate.
  assert.equal(parse({ location: "" }).criteria.location, null);
  assert.equal(parse({ propertyType: "" }).criteria.propertyType, null);

  const sparse = aiCriteriaSchema.parse({ bedrooms: 3 });
  const { criteria } = normaliseAiCriteria(sparse);
  assert.equal(criteria.bedrooms, 3);
  assert.equal(criteria.maxPrice, null);
  assert.deepEqual([...criteria.amenities], []);
  assert.equal(criteria.verifiedOnly, false);
});

// ─────────────────────────────────────────────────────────────
// Amenities
// ─────────────────────────────────────────────────────────────

test("amenity slugs off the allowlist are dropped and reported", () => {
  // Dropped rather than refused: a model will confidently invent "24x7-water"
  // for a slug spelled "water-supply-24x7", and failing the whole search over it
  // helps nobody. A `hasEvery` on a slug no row carries is an empty result set
  // with no explanation, so the visitor is told instead.
  const { criteria, droppedAmenities } = parse({
    amenities: ["lift", "24x7-water", "gym", "helipad"],
  });

  assert.deepEqual([...criteria.amenities], ["gym", "lift"]);
  assert.deepEqual([...droppedAmenities].sort(), ["24x7-water", "helipad"]);
});

test("amenities are deduplicated, lower-cased and bounded by the allowlist", () => {
  const { criteria } = parse({ amenities: ["LIFT", "lift", " Lift ", "gym"] });
  assert.deepEqual([...criteria.amenities], ["gym", "lift"]);

  const { criteria: all } = parse({ amenities: [...AMENITY_SLUGS, ...AMENITY_SLUGS] });
  assert.equal(all.amenities.length, AMENITY_SLUGS.length);
});

// ─────────────────────────────────────────────────────────────
// Ranges and text
// ─────────────────────────────────────────────────────────────

test("an inverted range is dropped from the top, not swapped", () => {
  // The same decision `parseBrowseQuery` makes: swapping silently answers a
  // question the visitor did not ask.
  const { criteria } = parse({ minPrice: 9_000_000, maxPrice: 5_000_000 });
  assert.equal(criteria.minPrice, 9_000_000);
  assert.equal(criteria.maxPrice, null);

  const { criteria: area } = parse({ minArea: 2000, maxArea: 800 });
  assert.equal(area.minArea, 2000);
  assert.equal(area.maxArea, null);
});

test("a place name is sanitised the same way the search box is", () => {
  // The value ends up in a `contains` filter and in the rendered page. A
  // provider is an untrusted input source like any other.
  assert.equal(parse({ location: "  Vikhroli   West  " }).criteria.location, "Vikhroli West");
  assert.equal(parse({ location: "Vikhroli<script>" }).criteria.location, "Vikhroli script");
  assert.equal(parse({ location: "Andheri (E)" }).criteria.location, "Andheri E");
  // Regex metacharacters cannot survive into a filter operand.
  assert.equal(parse({ location: ".*" }).criteria.location, null);
});

test("a place name is capped rather than refused", () => {
  const { criteria } = parse({ location: "a".repeat(500) });
  assert.ok(criteria.location);
  assert.ok(criteria.location.length <= 80, `length was ${criteria.location.length}`);
});

// ─────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────

test("the model cannot request the sort the application withholds", () => {
  // `lib/properties/ai.ts` withholds `ai-match` until a scorer is installed.
  // Letting the model ask for it would reintroduce a UI option that does nothing.
  assert.equal((AI_SORTS as readonly string[]).includes("ai-match"), false);
  assert.equal(aiCriteriaSchema.safeParse(reply({ sort: "ai-match" })).success, false);

  for (const sort of AI_SORTS) {
    assert.equal(aiCriteriaSchema.safeParse(reply({ sort })).success, true, sort);
    assert.equal(BROWSE_SORTS.includes(sort), true, `${sort} is not a real browse sort`);
  }
});

// ─────────────────────────────────────────────────────────────
// The contract sent to the provider
// ─────────────────────────────────────────────────────────────

test("the JSON schema and the Zod schema describe the same object", () => {
  // Two vocabularies would fail intermittently and look like a model problem: a
  // provider constrained to one and validated against the other.
  const jsonSchema = aiCriteriaJsonSchema() as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };

  const zodKeys = Object.keys(aiCriteriaSchema.shape).sort();
  const jsonKeys = Object.keys(jsonSchema.properties).sort();

  assert.deepEqual(jsonKeys, zodKeys);
  assert.deepEqual([...jsonSchema.required].sort(), zodKeys);
  assert.equal(jsonSchema.additionalProperties, false);
});

test("the JSON schema's enums are the database's own vocabularies", () => {
  const properties = (aiCriteriaJsonSchema() as { properties: Record<string, { enum?: unknown[] }> })
    .properties;

  const parking = (properties.parking.enum ?? []).filter((value) => value !== null);
  assert.deepEqual(parking, [...AI_PARKING_VALUES]);

  const proximity = (
    properties.proximity as unknown as { items: { enum: string[] } }
  ).items.enum;
  assert.deepEqual(proximity, [...AI_PROXIMITY_KINDS]);

  const amenities = (
    properties.amenities as unknown as { items: { enum: string[] } }
  ).items.enum;
  assert.deepEqual(amenities, [...AMENITY_SLUGS]);
});

// ─────────────────────────────────────────────────────────────
// The empty answer
// ─────────────────────────────────────────────────────────────

test("a reply with nothing in it is recognised as empty", () => {
  // "That was not a property search" is a real outcome, and the panel says so
  // rather than running an unfiltered query and calling it a recommendation.
  assert.equal(isEmptyAiCriteria(parse().criteria), true);
  assert.equal(isEmptyAiCriteria(EMPTY_AI_CRITERIA), true);
  assert.equal(isEmptyAiCriteria(parse({ bedrooms: 1 }).criteria), false);
  assert.equal(isEmptyAiCriteria(parse({ verifiedOnly: true }).criteria), false);
  assert.equal(isEmptyAiCriteria(parse({ proximity: ["METRO_STATION"] }).criteria), false);
});
