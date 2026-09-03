"use client";

/**
 * Loads the Google Maps JavaScript API exactly once per page session.
 *
 * ── Why a hand-written loader instead of a package ──────────────────────────
 *
 * `package.json` has no map library, and the project's stated architecture is to
 * avoid vendor SDKs where a documented HTTP surface will do — the same reasoning
 * `lib/otp/providers/` gives for talking to Resend and Twilio over `fetch`
 * instead of installing two clients. The Maps JS API is one `<script>` tag and a
 * callback; a React wrapper around it would be a dependency carrying its own
 * component model, its own release cadence and its own opinion about markers, in
 * exchange for code this file already contains.
 *
 * ── The single-instance rule ────────────────────────────────────────────────
 *
 * `pending` is module state, so every caller after the first awaits the *same*
 * promise: two map surfaces mounting together (Explore's map and, later, anything
 * else) share one script tag and one `google.maps` namespace. Loading the SDK
 * twice is not merely wasteful — Google logs a console error and the second load
 * can clobber the first's `importLibrary` registry.
 *
 * The promise is cached on success and cleared on failure, so a transient network
 * error does not permanently poison the map for the rest of the session while a
 * successful load is never repeated.
 *
 * ── Why nothing here runs at import time ───────────────────────────────────
 *
 * The script is requested by `loadGoogleMaps()`, which components call from an
 * effect — on intersection for the detail map, on view switch for Explore. So a
 * visitor who never scrolls to a map, and every page that has no map at all, pay
 * nothing: no script tag, no SDK bytes, no blocking of first render.
 */

import { MAPS_BROWSER_KEY } from "./config";

/** The slice of the SDK this app uses. Kept deliberately small — it is a contract
 *  with our own components, not a re-declaration of Google's typings. */
export type GoogleMapsApi = typeof google.maps;

const CALLBACK_NAME = "__propertynexMapsReady";
const SCRIPT_ID = "propertynex-google-maps";

let pending: Promise<GoogleMapsApi> | null = null;

/**
 * Resolve with `google.maps`, loading the SDK on first call.
 *
 * Rejects when no key is configured, so a caller that forgot to check
 * `isMapConfigured()` fails loudly in development rather than rendering an empty
 * grey box in production.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (pending) return pending;

  // Already present — another loader, a cached script, or a fast refresh that
  // preserved the window while resetting module state.
  if (typeof window !== "undefined" && window.google?.maps) {
    pending = Promise.resolve(window.google.maps);
    return pending;
  }

  if (!MAPS_BROWSER_KEY) {
    // Not cached: this is a configuration fact, and caching a rejection would
    // outlive a fix during development.
    return Promise.reject(new Error("Google Maps is not configured"));
  }

  pending = new Promise<GoogleMapsApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);

    const fail = () => {
      // Let a later attempt retry: a blocked or flaky first load should not
      // disable the map for the rest of the session.
      pending = null;
      reject(new Error("Google Maps failed to load"));
    };

    // Google calls this once the SDK is ready. A global is the API's own
    // contract, so it is namespaced rather than avoided.
    (window as unknown as Record<string, unknown>)[CALLBACK_NAME] = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else fail();
    };

    if (existing) {
      // A tag is already in flight from a previous mount whose module state was
      // discarded. Attach to it rather than adding a second.
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const params = new URLSearchParams({
      key: MAPS_BROWSER_KEY,
      // `marker` is the library holding AdvancedMarkerElement; `maps` is the core.
      libraries: "maps,marker",
      // Google's documented way to opt into the non-blocking loading path.
      loading: "async",
      callback: CALLBACK_NAME,
      v: "weekly",
    });

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.addEventListener("error", fail, { once: true });

    document.head.appendChild(script);
  });

  return pending;
}

/** True once the SDK is on the page, for a synchronous first-render decision. */
export function isGoogleMapsLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.google?.maps);
}
