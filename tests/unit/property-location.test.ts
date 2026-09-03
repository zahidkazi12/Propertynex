import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import type { LocationPrecision } from "@prisma/client";

import { publicMapAddress, toPublicMapLocation } from "../../lib/properties/location";

/**
 * `lib/properties/location.ts` — the gate between a stored coordinate and a public
 * map pin.
 *
 * ── Why this module gets its own tests ──────────────────────────────────────
 *
 * It is the only place in the app where location data crosses from "the owner's
 * record" into "what a stranger can see", and the two mistakes available to it are
 * both silent. Publishing an exact position that the owner asked to keep vague
 * leaks their address with no error anywhere; rounding a position that the owner
 * *did* publish exactly makes the product quietly less useful than promised.
 * Neither shows up in a type check, so they are asserted here.
 *
 * The third property under test is that reduced precision is still a *real*
 * position: rounding must be deterministic, so the same row yields the same pin on
 * the browse map and on the detail map. A random offset — the other common way to
 * "blur" a location — would fail that, and would place a marker on a building
 * nobody chose.
 */

const EXACT_LAT = 12.978432;
const EXACT_LNG = 77.640789;

/** A stored row, with the private default unless a test says otherwise. Written
 *  with explicit parameters rather than a spread of a `Partial`, so the argument
 *  types are exactly the function's own. */
function row(
  overrides: {
    latitude?: number | null;
    longitude?: number | null;
    locationPrecision?: LocationPrecision;
  } = {}
): {
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
} {
  return {
    latitude: overrides.latitude === undefined ? EXACT_LAT : overrides.latitude,
    longitude: overrides.longitude === undefined ? EXACT_LNG : overrides.longitude,
    locationPrecision: overrides.locationPrecision ?? "APPROXIMATE",
  };
}

// ─────────────────────────────────────────────────────────────
// The precision gate
// ─────────────────────────────────────────────────────────────

test("EXACT publishes the stored coordinate untouched", () => {
  const location = toPublicMapLocation(row({ locationPrecision: "EXACT" }));

  assert.deepEqual(location, {
    latitude: EXACT_LAT,
    longitude: EXACT_LNG,
    precision: "EXACT",
  });
});

test("APPROXIMATE rounds to three decimals and says so", () => {
  const location = toPublicMapLocation(row({ locationPrecision: "APPROXIMATE" }));

  assert.equal(location?.precision, "APPROXIMATE");
  assert.equal(location?.latitude, 12.978);
  assert.equal(location?.longitude, 77.641);
});

test("an approximate pin is never the exact pin", () => {
  // The whole point of the setting. If rounding ever became a no-op, this is the
  // test that fails rather than a privacy promise quietly becoming false.
  const approximate = toPublicMapLocation(row({ locationPrecision: "APPROXIMATE" }));
  const exact = toPublicMapLocation(row({ locationPrecision: "EXACT" }));

  assert.notEqual(approximate?.latitude, exact?.latitude);
  assert.notEqual(approximate?.longitude, exact?.longitude);
});

test("rounding is deterministic, so a pin does not move between pages", () => {
  // A random offset would satisfy "not the exact position" and fail this. The
  // browse map and the detail map must agree.
  const first = toPublicMapLocation(row());
  const second = toPublicMapLocation(row());
  assert.deepEqual(first, second);
});

test("an approximate pin stays within roughly a block of the real one", () => {
  // Reduced precision, not a different place: three decimals is ~110 m, so the
  // published pin must still be within that of the stored one. A "blur" that
  // wandered further would be inventing a location.
  const location = toPublicMapLocation(row());
  assert.ok(location);
  assert.ok(Math.abs(location.latitude - EXACT_LAT) < 0.001);
  assert.ok(Math.abs(location.longitude - EXACT_LNG) < 0.001);
});

test("a coordinate already coarser than the grid is unchanged by rounding", () => {
  const location = toPublicMapLocation(row({ latitude: 12.5, longitude: 77.25 }));
  assert.equal(location?.latitude, 12.5);
  assert.equal(location?.longitude, 77.25);
});

// ─────────────────────────────────────────────────────────────
// No coordinates is a real state
// ─────────────────────────────────────────────────────────────

test("a listing with no coordinates gets no pin", () => {
  // Every property predating this feature. The answer is null — no marker — not a
  // city-centre stand-in.
  assert.equal(toPublicMapLocation(row({ latitude: null, longitude: null })), null);
});

test("half a coordinate gets no pin", () => {
  // Validation refuses this on write, but a row imported before that rule existed
  // could hold it, and defaulting the missing axis to 0 would plot the listing in
  // the Atlantic.
  assert.equal(toPublicMapLocation(row({ latitude: EXACT_LAT, longitude: null })), null);
  assert.equal(toPublicMapLocation(row({ latitude: null, longitude: EXACT_LNG })), null);
});

test("an out-of-range or non-finite stored coordinate gets no pin", () => {
  const bad: Array<[number, number]> = [
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
  ];

  for (const [latitude, longitude] of bad) {
    assert.equal(
      toPublicMapLocation(row({ latitude, longitude })),
      null,
      `plotted ${latitude},${longitude}`
    );
  }
});

test("EXACT does not bypass the range check", () => {
  // The precision setting decides how much detail is published, never whether the
  // value is publishable at all.
  assert.equal(
    toPublicMapLocation(row({ latitude: 500, longitude: 500, locationPrecision: "EXACT" })),
    null
  );
});

// ─────────────────────────────────────────────────────────────
// The public address
// ─────────────────────────────────────────────────────────────

test("the public address is locality, city and state — and stops there", () => {
  assert.equal(
    publicMapAddress({ locality: "Indiranagar", city: "Bengaluru", state: "Karnataka" }),
    "Indiranagar, Bengaluru, Karnataka"
  );
});

test("a missing locality collapses rather than leaving a stray comma", () => {
  assert.equal(
    publicMapAddress({ locality: null, city: "Bengaluru", state: "Karnataka" }),
    "Bengaluru, Karnataka"
  );
  assert.equal(
    publicMapAddress({ locality: "   ", city: "Bengaluru", state: "Karnataka" }),
    "Bengaluru, Karnataka"
  );
});

test("the public address cannot carry a street line or a PIN code", () => {
  // Asserted structurally: the function's parameter type has no field for either,
  // so a caller that holds a full row cannot pass one through by accident. This
  // test documents the intent and fails loudly if the signature is ever widened.
  const withPrivateFields = {
    locality: "Indiranagar",
    city: "Bengaluru",
    state: "Karnataka",
    addressLine1: "12 Some Street",
    pincode: "560038",
  };

  const address = publicMapAddress(withPrivateFields);
  assert.equal(address.includes("Some Street"), false);
  assert.equal(address.includes("560038"), false);
});
