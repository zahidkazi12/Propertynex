import type { LocationPrecision } from "@prisma/client";

import type { PublicMapLocation } from "@/types";

/**
 * How a listing's coordinates become a public map pin.
 *
 * ── The problem this module exists to solve ─────────────────────────────────
 *
 * `lib/properties/public.ts` documents, at length, that the public projection
 * drops `addressLine1/2`, `pincode`, `latitude` and `longitude` — "a live listing
 * advertises its locality and city, not the exact door". A map view needs a
 * position, which means that boundary has to move. This module is where it moves
 * *to*, so the decision stays in one auditable place rather than being reasoned
 * about again at every call site.
 *
 * ── Reducing precision is not inventing a location ─────────────────────────
 *
 * `APPROXIMATE` rounds the stored coordinate to a fixed grid. That is a real
 * property of the real point — the same operation as quoting a price "in lakhs" —
 * and it is reported to the visitor as approximate, so nothing is implied that the
 * data does not support. It is emphatically *not* jitter: no random offset is
 * added, because a random offset invents a position that no one chose, moves every
 * time it is computed, and would put a pin on a neighbour's roof.
 *
 * Rounding is also stable, which matters more than it first appears: the same row
 * yields the same pin on the browse map and the detail map, so a visitor who
 * clicks through does not watch the marker jump.
 *
 * ── Why the default is the private one ─────────────────────────────────────
 *
 * `LocationPrecision` defaults to `APPROXIMATE` in the schema. Every listing that
 * existed before this feature supplied coordinates with no public map in the
 * product, so publishing them exactly would be a disclosure their owners were
 * never asked about. An owner who wants a precise pin opts in from the listing
 * form; nobody is opted in by a migration.
 */

/**
 * Decimal places kept for an approximate pin.
 *
 * Three places is ~110 m of latitude — a city block. Close enough for "this
 * listing is in this part of this locality", too coarse to identify a building,
 * which is exactly the line the projection is trying to draw. Two places (~1.1 km)
 * would be useless on a map zoomed to a neighbourhood; four (~11 m) would identify
 * the building and make the setting decorative.
 */
const APPROXIMATE_DECIMALS = 3;

/** Guard against a stored value that predates validation, or a NaN from a bad
 *  import. Mirrors the bounds `lib/validation/property.ts` enforces on write. */
function isUsableCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/**
 * The public map position for a listing, or `null`.
 *
 * `null` covers three cases the caller does not need to tell apart, because they
 * render identically: the owner supplied no coordinates, supplied only one axis
 * (validation refuses that on write, but old rows may hold it), or supplied
 * something out of range. In every case the listing gets no marker at all — no
 * placeholder pin, no city-centre stand-in.
 */
export function toPublicMapLocation(property: {
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
}): PublicMapLocation | null {
  const { latitude, longitude, locationPrecision } = property;

  // Both axes or neither: half a coordinate cannot place a pin, and defaulting
  // the missing one to 0 puts the listing in the Gulf of Guinea — the same trap
  // `lib/validation/property.ts` refuses on write.
  if (latitude === null || longitude === null) return null;
  if (!isUsableCoordinate(latitude, longitude)) return null;

  if (locationPrecision === "EXACT") {
    return { latitude, longitude, precision: "EXACT" };
  }

  return {
    latitude: round(latitude, APPROXIMATE_DECIMALS),
    longitude: round(longitude, APPROXIMATE_DECIMALS),
    precision: "APPROXIMATE",
  };
}

/**
 * The address a public map is allowed to say out loud.
 *
 * Locality, city, state — deliberately not `addressLine1` or `pincode`. This is
 * the string handed to `lib/maps/links.ts` when a listing has no coordinates, so
 * a "Get directions" action on such a listing routes to the locality rather than
 * to a door the projection is not allowed to name. Coarse, and honestly so.
 */
export function publicMapAddress(property: {
  locality: string | null;
  city: string;
  state: string;
}): string {
  return [property.locality, property.city, property.state]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}
