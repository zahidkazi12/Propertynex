/**
 * Google Maps URLs, built as strings.
 *
 * ── Why this module has no dependency and no API key ────────────────────────
 *
 * Every function here produces a documented Google Maps URL Scheme link
 * (`https://developers.google.com/maps/documentation/urls/get-started`). Those
 * URLs need no SDK, no `<script>`, no billing and no key — they open Google Maps
 * in a new tab on desktop and hand off to the native app on Android/iOS. So
 * "Get directions" keeps working in a deployment that has no maps key at all,
 * which is what makes the unconfigured state a *reduced* experience rather than a
 * broken one.
 *
 * That is also why this file is separate from `./config` and `./loader`: those
 * two are about the interactive JavaScript map, which is optional. This one is
 * always available, is pure, and is safe to call from a Server Component, a
 * Client Component and a unit test alike.
 *
 * ── Coordinates beat addresses, and neither is invented ────────────────────
 *
 * Each builder takes a `MapTarget` that carries coordinates, a text address, or
 * both, and prefers coordinates when present because a lat/lng lands on the
 * actual point while a text address is geocoded by Google and can resolve to the
 * middle of a locality. When neither is present the builders return `null` — no
 * placeholder pin, no "0,0", no guessed city centre. A caller that gets `null`
 * renders no directions action, which is the honest outcome.
 */

/** A place to point Google Maps at. Both fields optional; at least one is needed
 *  for any builder to return a URL. */
export type MapTarget = {
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  /** Human-readable address, already assembled by the caller. */
  readonly address?: string | null;
};

/**
 * `lat,lng` to six decimal places, or null.
 *
 * Six is where Google's own URL documentation sits and is ~11 cm — far finer than
 * anything this product stores, so the cap only exists to stop a float artefact
 * (`77.59460000000001`) from ending up in a URL. Non-finite values are rejected
 * rather than stringified into `NaN,NaN`.
 */
function coordinatePair(target: MapTarget): string | null {
  const { latitude, longitude } = target;

  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // Range-checked here as well as at validation, because this string is about to
  // become a URL handed to the browser and a caller may have loaded a row that
  // predates the validation rules.
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  const trim = (value: number) => String(Number(value.toFixed(6)));
  return `${trim(latitude)},${trim(longitude)}`;
}

/** A non-blank address, trimmed, or null. */
function addressQuery(target: MapTarget): string | null {
  const address = target.address?.trim();
  return address ? address : null;
}

/** Coordinates if we have them, else the address, else null. */
function queryFor(target: MapTarget): string | null {
  return coordinatePair(target) ?? addressQuery(target);
}

/**
 * Turn-by-turn directions to the target, from wherever the user is.
 *
 * `origin` is deliberately omitted: Google fills it from the device's own
 * location, which is both more accurate than anything this app could supply and
 * the only version that does not require asking the visitor for a location
 * permission we have no other use for.
 */
export function directionsUrl(target: MapTarget): string | null {
  const destination = queryFor(target);
  if (!destination) return null;

  const params = new URLSearchParams({ api: "1", destination });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** The target shown as a place on the map, without directions. */
export function placeUrl(target: MapTarget): string | null {
  const query = queryFor(target);
  if (!query) return null;

  const params = new URLSearchParams({ api: "1", query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * A Maps Embed API `src` for an `<iframe>`, or null when unavailable.
 *
 * The Embed API is a separate product from the Maps JavaScript API: it renders a
 * real, pannable Google map from a plain iframe with no script tag and no client
 * library. It still needs a key, so this returns null without one — but where a
 * single static marker is all that is needed (the detail page), an iframe is
 * cheaper than booting the SDK and cannot leak a second map instance.
 */
export function embedMapUrl(target: MapTarget, apiKey: string, zoom = 15): string | null {
  if (!apiKey) return null;

  const query = queryFor(target);
  if (!query) return null;

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    zoom: String(zoom),
  });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}

/** True when Google Maps can be pointed at this target at all. */
export function hasMapTarget(target: MapTarget): boolean {
  return queryFor(target) !== null;
}

/** True when the target carries real coordinates, as opposed to only an address. */
export function hasCoordinates(target: MapTarget): boolean {
  return coordinatePair(target) !== null;
}
