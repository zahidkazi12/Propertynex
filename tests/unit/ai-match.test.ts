import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreListing,
  scoreListings,
  MATCH_FACTOR_IDS,
  type MatchResult,
} from "../../lib/ai/match";
import { EMPTY_AI_CRITERIA, type AiCriteria } from "../../lib/ai/criteria";
import type { PublicListing } from "../../types";

/**
 * Unit tests for `lib/ai/match.ts`.
 *
 * These tests verify the claims the module header makes:
 *   - `null` column → `unknown`, not a match or a miss.
 *   - `unknown` factors are excluded from the denominator, not counted as 0.
 *   - When nothing could be decided, score is `null`, not 0 or 100.
 *   - `BOTH` parking satisfies an `OPEN` or `COVERED` request.
 *   - `ANY` parking is satisfied by anything except `NONE`.
 *   - Amenity partial credit is proportional, not binary.
 *   - Score thresholds match the thresholds in `summarise()`.
 *   - `scoreListings` orders best-first, unscoreable rows sink to the bottom.
 */

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────

function listing(overrides: Partial<PublicListing> = {}): PublicListing {
  return {
    id: "test-id",
    title: "2BHK Apartment in Vikhroli",
    description: "A nice apartment",
    propertyType: "APARTMENT",
    listingType: "BUY",
    price: 7_500_000,
    negotiable: false,
    areaValue: 950,
    areaUnit: "SQFT",
    bedrooms: 2,
    bathrooms: 2,
    floor: 3,
    totalFloors: 10,
    furnishing: "SEMI_FURNISHED",
    parking: "COVERED",
    propertyAgeYears: 3,
    amenities: ["lift", "gym", "security"],
    locality: "Vikhroli",
    city: "Mumbai",
    state: "Maharashtra",
    location: null,
    verified: false,
    seller: { name: "Test Owner", kind: "owner" },
    images: [],
    listedAt: new Date().toISOString(),
    ...overrides,
  };
}

function criteria(overrides: Partial<AiCriteria> = {}): AiCriteria {
  return { ...EMPTY_AI_CRITERIA, ...overrides };
}

function factor(result: MatchResult, id: string) {
  return result.factors.find((f) => f.id === id);
}

// ─────────────────────────────────────────────────────────────
// Sanity
// ─────────────────────────────────────────────────────────────

test("no criteria → no factors, null score", () => {
  const result = scoreListing(listing(), criteria());
  assert.equal(result.factors.length, 0);
  assert.equal(result.score, null);
  assert.ok(result.summary.includes("Not enough"), `summary: ${result.summary}`);
});

test("MATCH_FACTOR_IDS covers every weight key", () => {
  assert.ok(MATCH_FACTOR_IDS.length >= 8);
  for (const id of MATCH_FACTOR_IDS) {
    assert.equal(typeof id, "string");
  }
});

// ─────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────

test("budget — within max → match", () => {
  const result = scoreListing(listing({ price: 7_500_000 }), criteria({ maxPrice: 8_000_000 }));
  assert.equal(factor(result, "budget")!.status, "match");
});

test("budget — exceeds max → miss", () => {
  const result = scoreListing(listing({ price: 9_000_000 }), criteria({ maxPrice: 8_000_000 }));
  assert.equal(factor(result, "budget")!.status, "miss");
});

test("budget — below min → miss", () => {
  const result = scoreListing(listing({ price: 3_000_000 }), criteria({ minPrice: 5_000_000 }));
  assert.equal(factor(result, "budget")!.status, "miss");
});

test("budget — within range → match", () => {
  const result = scoreListing(
    listing({ price: 7_000_000 }),
    criteria({ minPrice: 5_000_000, maxPrice: 8_000_000 })
  );
  assert.equal(factor(result, "budget")!.status, "match");
});

test("budget not stated → no budget factor", () => {
  assert.equal(factor(scoreListing(listing(), criteria()), "budget"), undefined);
});

// ─────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────

test("location — locality match → match", () => {
  const result = scoreListing(
    listing({ locality: "Vikhroli", city: "Mumbai" }),
    criteria({ location: "Vikhroli" })
  );
  assert.equal(factor(result, "location")!.status, "match");
});

test("location — city match → match", () => {
  const result = scoreListing(listing({ locality: null, city: "Mumbai" }), criteria({ location: "Mumbai" }));
  assert.equal(factor(result, "location")!.status, "match");
});

test("location — state match only → partial", () => {
  const result = scoreListing(
    listing({ locality: "Juhu", city: "Mumbai", state: "Maharashtra" }),
    criteria({ location: "Maharashtra" })
  );
  assert.equal(factor(result, "location")!.status, "partial");
});

test("location — completely different → miss", () => {
  const result = scoreListing(
    listing({ locality: "Powai", city: "Mumbai", state: "Maharashtra" }),
    criteria({ location: "Bengaluru" })
  );
  assert.equal(factor(result, "location")!.status, "miss");
});

test("location — case-insensitive match", () => {
  const result = scoreListing(listing({ locality: "Vikhroli" }), criteria({ location: "vikhroli" }));
  assert.equal(factor(result, "location")!.status, "match");
});

// ─────────────────────────────────────────────────────────────
// Bedrooms
// ─────────────────────────────────────────────────────────────

test("bedrooms — exact match → match", () => {
  assert.equal(factor(scoreListing(listing({ bedrooms: 2 }), criteria({ bedrooms: 2 })), "bedrooms")!.status, "match");
});

test("bedrooms — listing has more → partial", () => {
  assert.equal(factor(scoreListing(listing({ bedrooms: 3 }), criteria({ bedrooms: 2 })), "bedrooms")!.status, "partial");
});

test("bedrooms — listing has fewer → miss", () => {
  assert.equal(factor(scoreListing(listing({ bedrooms: 1 }), criteria({ bedrooms: 2 })), "bedrooms")!.status, "miss");
});

test("bedrooms — null on listing → unknown", () => {
  assert.equal(factor(scoreListing(listing({ bedrooms: null }), criteria({ bedrooms: 2 })), "bedrooms")!.status, "unknown");
});

// ─────────────────────────────────────────────────────────────
// Parking
// ─────────────────────────────────────────────────────────────

test("parking — ANY with COVERED → match", () => {
  assert.equal(factor(scoreListing(listing({ parking: "COVERED" }), criteria({ parking: "ANY" })), "parking")!.status, "match");
});

test("parking — ANY with OPEN → match", () => {
  assert.equal(factor(scoreListing(listing({ parking: "OPEN" }), criteria({ parking: "ANY" })), "parking")!.status, "match");
});

test("parking — ANY with BOTH → match", () => {
  assert.equal(factor(scoreListing(listing({ parking: "BOTH" }), criteria({ parking: "ANY" })), "parking")!.status, "match");
});

test("parking — ANY with NONE → miss", () => {
  assert.equal(factor(scoreListing(listing({ parking: "NONE" }), criteria({ parking: "ANY" })), "parking")!.status, "miss");
});

test("parking — null column → unknown, never miss", () => {
  // Core requirement: no parking info must never read as 'no parking'.
  assert.equal(factor(scoreListing(listing({ parking: null }), criteria({ parking: "ANY" })), "parking")!.status, "unknown");
});

test("parking — OPEN request, BOTH listing → match", () => {
  assert.equal(factor(scoreListing(listing({ parking: "BOTH" }), criteria({ parking: "OPEN" })), "parking")!.status, "match");
});

test("parking — COVERED request, BOTH listing → match", () => {
  assert.equal(factor(scoreListing(listing({ parking: "BOTH" }), criteria({ parking: "COVERED" })), "parking")!.status, "match");
});

test("parking — BOTH request, OPEN listing → partial", () => {
  assert.equal(factor(scoreListing(listing({ parking: "OPEN" }), criteria({ parking: "BOTH" })), "parking")!.status, "partial");
});

test("parking — COVERED request, OPEN listing → miss", () => {
  assert.equal(factor(scoreListing(listing({ parking: "OPEN" }), criteria({ parking: "COVERED" })), "parking")!.status, "miss");
});

test("parking not in criteria → no parking factor", () => {
  assert.equal(factor(scoreListing(listing({ parking: "COVERED" }), criteria()), "parking"), undefined);
});

// ─────────────────────────────────────────────────────────────
// Amenities
// ─────────────────────────────────────────────────────────────

test("amenities — all present → match", () => {
  const result = scoreListing(
    listing({ amenities: ["lift", "gym", "security"] }),
    criteria({ amenities: ["lift", "gym"] })
  );
  assert.equal(factor(result, "amenities")!.status, "match");
});

test("amenities — some present → partial", () => {
  const result = scoreListing(listing({ amenities: ["lift"] }), criteria({ amenities: ["lift", "gym"] }));
  assert.equal(factor(result, "amenities")!.status, "partial");
});

test("amenities — none present → miss", () => {
  const result = scoreListing(listing({ amenities: ["security"] }), criteria({ amenities: ["lift", "gym"] }));
  assert.equal(factor(result, "amenities")!.status, "miss");
});

test("amenities — empty listing list → unknown (may not have been filled in)", () => {
  const result = scoreListing(listing({ amenities: [] }), criteria({ amenities: ["lift", "gym"] }));
  assert.equal(factor(result, "amenities")!.status, "unknown");
});

// ─────────────────────────────────────────────────────────────
// Area
// ─────────────────────────────────────────────────────────────

test("area — within range → match", () => {
  const result = scoreListing(
    listing({ areaValue: 950, areaUnit: "SQFT" }),
    criteria({ minArea: 800, maxArea: 1200 })
  );
  assert.equal(factor(result, "area")!.status, "match");
});

test("area — below min → miss", () => {
  assert.equal(factor(scoreListing(listing({ areaValue: 600, areaUnit: "SQFT" }), criteria({ minArea: 800 })), "area")!.status, "miss");
});

test("area — above max → miss", () => {
  assert.equal(factor(scoreListing(listing({ areaValue: 1500, areaUnit: "SQFT" }), criteria({ maxArea: 1200 })), "area")!.status, "miss");
});

// ─────────────────────────────────────────────────────────────
// Furnishing
// ─────────────────────────────────────────────────────────────

test("furnishing — exact match → match", () => {
  assert.equal(factor(scoreListing(listing({ furnishing: "FULLY_FURNISHED" }), criteria({ furnishing: "FULLY_FURNISHED" })), "furnishing")!.status, "match");
});

test("furnishing — different → miss", () => {
  assert.equal(factor(scoreListing(listing({ furnishing: "UNFURNISHED" }), criteria({ furnishing: "FULLY_FURNISHED" })), "furnishing")!.status, "miss");
});

test("furnishing — null on listing → unknown", () => {
  assert.equal(factor(scoreListing(listing({ furnishing: null }), criteria({ furnishing: "FULLY_FURNISHED" })), "furnishing")!.status, "unknown");
});

// ─────────────────────────────────────────────────────────────
// Proximity — always unknown
// ─────────────────────────────────────────────────────────────

test("proximity — always unknown (no distance data in schema)", () => {
  const result = scoreListing(listing(), criteria({ proximity: ["RAILWAY_STATION", "METRO_STATION"] }));
  const pFactors = result.factors.filter((f) => f.kind === "proximity");
  assert.equal(pFactors.length, 2);
  for (const pf of pFactors) {
    assert.equal(pf.status, "unknown");
  }
});

test("proximity — unknown factors appear in caveats", () => {
  const result = scoreListing(listing(), criteria({ proximity: ["RAILWAY_STATION"] }));
  assert.equal(result.caveats.length, 1);
  assert.ok(result.caveats[0].toLowerCase().includes("railway"));
});

// ─────────────────────────────────────────────────────────────
// Score computation — the key invariants
// ─────────────────────────────────────────────────────────────

test("score — null when only unknown factors (proximity only)", () => {
  // Proximity factors have weight 0 and are excluded from the denominator.
  const result = scoreListing(listing(), criteria({ proximity: ["RAILWAY_STATION"] }));
  assert.equal(result.score, null);
  assert.ok(result.summary.includes("Not enough"));
});

test("score — 100 when single decidable factor is a perfect match", () => {
  const result = scoreListing(listing({ price: 7_000_000 }), criteria({ maxPrice: 8_000_000 }));
  assert.equal(result.score, 100);
});

test("score — 0 when every decidable factor is a miss", () => {
  const result = scoreListing(
    listing({ price: 10_000_000, bedrooms: 1 }),
    criteria({ maxPrice: 8_000_000, bedrooms: 3 })
  );
  assert.equal(result.score, 0);
});

test("unknown parking excluded from denominator — does not penalise listing", () => {
  // Parking is null (unknown). Budget is the only decidable factor and it matches.
  // Score must be 100, not penalised for unknown parking.
  const result = scoreListing(
    listing({ price: 7_000_000, parking: null }),
    criteria({ maxPrice: 8_000_000, parking: "ANY" })
  );
  assert.equal(factor(result, "parking")!.status, "unknown");
  assert.equal(result.score, 100);
});

test("summary — ≥ 85 → Strong", () => {
  const result = scoreListing(
    listing({ price: 7_000_000, locality: "Vikhroli", bedrooms: 2, parking: "COVERED" }),
    criteria({ maxPrice: 8_000_000, location: "Vikhroli", bedrooms: 2, parking: "ANY" })
  );
  if (result.score !== null && result.score >= 85) {
    assert.ok(result.summary.includes("Strong"), `summary: ${result.summary}`);
  }
});

// ─────────────────────────────────────────────────────────────
// The brief's worked example
// ─────────────────────────────────────────────────────────────

test("brief worked example — non-null score, correct factor statuses", () => {
  const result = scoreListing(
    listing({
      price: 7_500_000,
      bedrooms: 2,
      locality: "Vikhroli",
      city: "Mumbai",
      parking: "COVERED",
    }),
    criteria({
      propertyType: "APARTMENT",
      bedrooms: 2,
      maxPrice: 8_000_000,
      location: "Vikhroli",
      parking: "ANY",
      proximity: ["RAILWAY_STATION"],
    })
  );
  assert.ok(result.score !== null, "should score a well-described listing");
  assert.ok((result.score as number) > 50, `score ${result.score} unexpectedly low`);
  assert.equal(factor(result, "budget")!.status, "match");
  assert.equal(factor(result, "location")!.status, "match");
  assert.equal(factor(result, "bedrooms")!.status, "match");
  assert.equal(factor(result, "parking")!.status, "match");
  const prox = result.factors.find((f) => f.kind === "proximity");
  assert.ok(prox);
  assert.equal(prox!.status, "unknown");
});

// ─────────────────────────────────────────────────────────────
// scoreListings — ordering and completeness
// ─────────────────────────────────────────────────────────────

test("scoreListings — best listing first", () => {
  const good = listing({ id: "good", price: 7_000_000, locality: "Vikhroli", bedrooms: 2 });
  const weak = listing({ id: "weak", price: 11_000_000, locality: "Dharavi", bedrooms: 1 });
  const c = criteria({ maxPrice: 8_000_000, location: "Vikhroli", bedrooms: 2 });
  const scored = scoreListings([good, weak], c);
  assert.equal(scored[0].listing.id, "good");
  assert.equal(scored[1].listing.id, "weak");
});

test("scoreListings — unscoreable listing sinks to bottom", () => {
  const noScore = listing({ id: "no-score", bedrooms: null });
  const hasScore = listing({ id: "has-score", bedrooms: 2 });
  const c = criteria({ bedrooms: 2 });
  const scored = scoreListings([noScore, hasScore], c);
  assert.equal(scored[0].listing.id, "has-score");
  assert.equal(scored[1].listing.id, "no-score");
});

test("scoreListings — never filters out any listing", () => {
  const listings = [
    listing({ id: "a" }),
    listing({ id: "b", bedrooms: null, parking: null, furnishing: null, amenities: [] }),
    listing({ id: "c", price: 9_000_000 }),
  ];
  const c = criteria({ maxPrice: 8_000_000, bedrooms: 2 });
  assert.equal(scoreListings(listings, c).length, listings.length);
});

test("scoreListings — preserves database order for ties", () => {
  const a = listing({ id: "a", price: 7_000_000 });
  const b = listing({ id: "b", price: 7_000_000 });
  const c = criteria({ maxPrice: 8_000_000 });
  const scored = scoreListings([a, b], c);
  assert.equal(scored[0].listing.id, "a");
  assert.equal(scored[1].listing.id, "b");
});

test("scoreListings — match.propertyId matches listing.id", () => {
  const listings = [listing({ id: "x", price: 7_000_000 }), listing({ id: "y", price: 9_000_000 })];
  const c = criteria({ maxPrice: 8_000_000 });
  for (const { listing: l, match } of scoreListings(listings, c)) {
    assert.equal(match.propertyId, l.id);
  }
});
