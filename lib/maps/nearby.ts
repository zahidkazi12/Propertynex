import "server-only";

/**
 * Whether nearby-place information can be shown, and the seam where a provider
 * would plug in.
 *
 * ── Why this ships with no provider ────────────────────────────────────────
 *
 * "Nearby: 1.2 km to the metro" is only worth rendering if it is true. Producing
 * it requires a places/routing provider — Google Places Nearby Search, Overpass,
 * an operator's own dataset — and this deployment has none configured. So the
 * section is absent rather than filled with plausible numbers.
 *
 * That is not a shortcut: a fabricated distance is worse than a missing one in a
 * way that matters commercially. Someone chooses a flat because the listing said
 * the station was a ten-minute walk. A guessed figure, or a straight-line
 * "distance" presented as a walk, is a claim about a purchase decision that the
 * product cannot stand behind.
 *
 * ── Why a slot and not an env flag ─────────────────────────────────────────
 *
 * Exactly the reasoning `lib/properties/ai.ts` gives for `MatchScorer`, and the
 * same shape, so there is one pattern in this codebase for "a capability that is
 * honestly absent until something real fills it": an env flag can be set with
 * nothing behind it, which is how a UI ends up promising data it cannot fetch. A
 * slot can only be non-null if code filled it.
 *
 * ── What an implementation must not do ─────────────────────────────────────
 *
 * `distanceLabel` is a string rather than a number of metres on purpose. A
 * provider that knows a walking duration should say so ("8 min walk"); one that
 * only knows a straight line must say *that* ("1.2 km away"). Forcing the caller
 * to render a number it cannot characterise is how "as the crow flies" silently
 * becomes "walking distance" in the UI.
 *
 * `server-only`: a provider holds a billed, non-public API key. The availability
 * answer is computed on the server and passed to components as data — a client
 * component reading this module would be a build error, which is the intent.
 */

/** Categories the UI knows how to label and icon. A provider returning anything
 *  else has its rows dropped rather than rendered as "unknown". */
export const NEARBY_CATEGORIES = [
  "TRANSIT_RAIL",
  "TRANSIT_METRO",
  "AIRPORT",
  "HOSPITAL",
  "SCHOOL",
  "SHOPPING",
] as const;

export type NearbyCategory = (typeof NEARBY_CATEGORIES)[number];

export type NearbyPlace = {
  readonly name: string;
  readonly category: NearbyCategory;
  /**
   * Already-formatted and already-qualified: "8 min walk", "1.2 km away".
   * Never a bare number — see the module header.
   */
  readonly distanceLabel: string;
};

export type NearbyProvider = {
  /** For logs. */
  readonly name: string;
  /**
   * Places near a coordinate.
   *
   * Takes a coordinate rather than a property so an implementation cannot reach
   * into a listing for the private address, and returns a plain list so it cannot
   * decide how any of it is rendered.
   */
  lookup(input: {
    readonly latitude: number;
    readonly longitude: number;
  }): Promise<readonly NearbyPlace[]>;
};

let provider: NearbyProvider | null = null;

/** Install a provider (or `null` to remove one). Nothing calls this yet. */
export function installNearbyProvider(next: NearbyProvider | null): void {
  provider = next;
}

export function isNearbyAvailable(): boolean {
  return provider !== null;
}

/**
 * Nearby places for a coordinate, or `null` when the capability is absent.
 *
 * `null` and `[]` mean different things and the UI renders them differently:
 * `null` is "this deployment cannot answer", `[]` is "it answered, and there is
 * nothing notable nearby". Collapsing the two would either advertise a missing
 * feature as an empty result or claim a quiet neighbourhood is a configuration
 * problem.
 *
 * A provider that throws is treated as `null` and logged server-side. A nearby
 * list is an accessory to the listing; it does not get to take the page down.
 */
export async function findNearbyPlaces(input: {
  latitude: number;
  longitude: number;
}): Promise<readonly NearbyPlace[] | null> {
  if (!provider) return null;

  try {
    const places = await provider.lookup(input);
    return places.filter((place) => NEARBY_CATEGORIES.includes(place.category));
  } catch (error) {
    console.error(`[nearby] provider "${provider.name}" failed:`, error);
    return null;
  }
}
