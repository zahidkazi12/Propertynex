/**
 * Whether the interactive Google map is configured, and with which key.
 *
 * ── Which key is public, and why that is not a mistake ──────────────────────
 *
 * The Maps JavaScript API and the Maps Embed API are browser products: the key
 * travels in a `<script src>` / `<iframe src>` and is visible to anyone who opens
 * devtools. That is how Google designs them, which is why the key here is
 * deliberately `NEXT_PUBLIC_`-prefixed — Next inlines it into the client bundle,
 * and it is meant to be there.
 *
 * A browser key is therefore protected by *restriction*, not by secrecy: in the
 * Google Cloud console, restrict it to your HTTP referrers and to the Maps
 * JavaScript + Embed APIs only. `.env.example` says so at the variable.
 *
 * Nothing server-only is read in this file, so importing it from a Client
 * Component cannot leak a secret. Any future key that must stay private (a
 * Places or Geocoding key, billed per call) belongs in a server-only module —
 * `lib/maps/nearby.ts` is the seam for that — and must never be given a
 * `NEXT_PUBLIC_` name.
 *
 * ── Why "configured" is a function and not a constant ──────────────────────
 *
 * Callers ask the question in both runtimes. On the server it reads the real
 * environment; in the browser it reads the value Next inlined at build time. A
 * single helper keeps both answers derived from one expression, so a page cannot
 * decide the map is available while the component that renders it disagrees.
 */

/**
 * The browser key, or an empty string.
 *
 * Read as a static property access rather than through a variable, because
 * Next's build-time substitution only rewrites the literal
 * `process.env.NEXT_PUBLIC_…` form. Destructuring `process.env` would leave
 * `undefined` in the client bundle.
 */
export const MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * True when an interactive map can be rendered.
 *
 * Every map surface checks this and falls back to a static location panel when it
 * is false. The fallback is a designed state, not an error state: it still shows
 * the locality and still offers directions through `lib/maps/links.ts`, which
 * needs no key.
 */
export function isMapConfigured(): boolean {
  return MAPS_BROWSER_KEY.length > 0;
}

/** Map defaults. Centred on India, matching the product's address model
 *  (`pincode` is validated as a 6-digit Indian PIN, `country` defaults to India). */
export const MAP_DEFAULTS = {
  /** Geographic centre of India — used only as the initial camera when a map has
   *  no markers at all, never as a substitute for a listing's own position. */
  center: { lat: 22.5937, lng: 78.9629 },
  /** Wide enough to show the country when nothing is plotted. */
  zoom: 4,
  /** A single listing, close enough to read the street grid around it. */
  detailZoom: 15,
  /** A single listing whose position is only approximate — pulled back, so the
   *  pin does not imply more precision than the data carries. */
  approximateZoom: 14,
} as const;
