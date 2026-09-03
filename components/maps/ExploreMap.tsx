"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MapPin } from "lucide-react";

import { MapMarkerPreview } from "@/components/maps/MapMarkerPreview";
import { MAP_DEFAULTS } from "@/lib/maps/config";
import { loadGoogleMaps } from "@/lib/maps/loader";
import type { PublicListing, PublicMapLocation } from "@/types";

/**
 * The interactive Explore map.
 *
 * ── What it plots, and what it refuses to plot ──────────────────────────────
 *
 * Exactly the listings it is handed that carry a `location`. The array comes
 * straight from `browsePublicListings`, so the map is a view of the *current
 * filters* — never a separate query, which is what would let the map and the list
 * disagree about what matches. Listings with no coordinates are counted and
 * reported ("N of M have no map pin") rather than dropped silently or given a
 * stand-in position: a marker nobody placed is worse than an absent one, because
 * a buyer would drive to it.
 *
 * ── One map instance, rebuilt never ─────────────────────────────────────────
 *
 * The `google.maps.Map` is created once, on mount, into a ref. Filter changes
 * arrive as a new `listings` prop and diff the *markers* — the map, its camera and
 * the SDK are untouched. Recreating the map per render would re-request tiles on
 * every keystroke in the search box.
 *
 * ── Why the SDK load lives here and not in the page ─────────────────────────
 *
 * `loadGoogleMaps()` is called from an effect, so the script is requested only
 * once this component actually mounts — which happens only when the visitor
 * chooses the map view. A visitor who stays on the list never downloads it, and
 * `/buy`, `/rent` and the detail page never touch it at all.
 */

/** A pin, drawn as an inline SVG data URL so it needs no network request and no
 *  Map ID. Cyan to match the brand's accent; the selected variant is larger and
 *  ringed, so selection is carried by size and shape rather than colour alone. */
function pinIcon(selected: boolean): string {
  const fill = selected ? "%2306b6d4" : "%230e7490";
  const stroke = selected ? "%23ffffff" : "%2367e8f9";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 32'>` +
    `<path d='M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0z' fill='${fill}' stroke='${stroke}' stroke-width='1.5'/>` +
    `<circle cx='12' cy='12' r='4.5' fill='${stroke}'/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

type Status = "loading" | "ready" | "failed";

/** A listing that is known to carry a position, so the marker code never needs a
 *  non-null assertion on `location`. */
type PlottableListing = PublicListing & { location: PublicMapLocation };

export function ExploreMap({
  listings,
  savedIds,
  signedIn,
  redirectTo,
}: {
  listings: readonly PublicListing[];
  /** Which of them the viewer has saved, from the same `BrowseResult` the list
   *  view renders — so a heart cannot differ between the two presentations. */
  savedIds: ReadonlySet<string>;
  signedIn: boolean;
  redirectTo: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

  const [status, setStatus] = useState<Status>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Only the listings that can actually be drawn. Memoised so the marker effect
   *  does not re-run on an unrelated parent render. */
  const plottable = useMemo(
    () =>
      listings.filter((listing): listing is PlottableListing => listing.location !== null),
    [listings]
  );

  const missingCount = listings.length - plottable.length;

  /** The selected listing, resolved against the *current* result set on every
   *  render rather than stored alongside the id. A selection whose listing has
   *  been filtered away therefore resolves to `null` on the same render that drops
   *  its marker, so the preview cannot outlive the pin it belongs to — without an
   *  effect that would commit the stale preview once and correct it after. */
  const selected = plottable.find((listing) => listing.id === selectedId) ?? null;

  // ── Create the map, once ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        mapRef.current = new maps.Map(containerRef.current, {
          center: MAP_DEFAULTS.center,
          zoom: MAP_DEFAULTS.zoom,
          // A phone's one-finger drag scrolls the *page*; two fingers pan the map.
          // Without this a map in a scrolling column traps the scroll and the
          // visitor cannot get past it.
          gestureHandling: "cooperative",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          clickableIcons: false,
          backgroundColor: "#0f172a",
          styles: DARK_STYLE,
        });

        // Tapping the map dismisses the preview, which is the gesture people try
        // first and the escape route on a touch device with no visible close.
        mapRef.current.addListener("click", () => setSelectedId(null));

        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Sync markers with the current result set ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !window.google?.maps) return;

    const maps = window.google.maps;
    const markers = markersRef.current;
    const wanted = new Set(plottable.map((listing) => listing.id));

    // Remove markers whose listing left the result set.
    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        marker.setMap(null);
        markers.delete(id);
      }
    }

    // Add markers for listings that just entered it.
    for (const listing of plottable) {
      if (markers.has(listing.id)) continue;

      const position = {
        lat: listing.location.latitude,
        lng: listing.location.longitude,
      };

      const marker = new maps.Marker({
        position,
        map,
        title: listing.title,
        icon: {
          url: pinIcon(false),
          scaledSize: new maps.Size(24, 32),
          anchor: new maps.Point(12, 32),
        },
      });

      marker.addListener("click", () => setSelectedId(listing.id));
      markers.set(listing.id, marker);
    }

    // Frame the results. Only when there are markers — `fitBounds` on an empty
    // bounds throws the camera to the middle of the ocean.
    if (plottable.length > 0) {
      const bounds = new maps.LatLngBounds();
      for (const listing of plottable) {
        bounds.extend({ lat: listing.location.latitude, lng: listing.location.longitude });
      }
      map.fitBounds(bounds, 64);

      // A single marker makes `fitBounds` zoom to the maximum, which shows one
      // rooftop and no context. Pull back to a neighbourhood.
      if (plottable.length === 1) {
        map.setCenter({
          lat: plottable[0].location.latitude,
          lng: plottable[0].location.longitude,
        });
        map.setZoom(MAP_DEFAULTS.approximateZoom);
      }
    }
  }, [plottable, status]);

  // ── Reflect selection in the markers ─────────────────────────────────────
  useEffect(() => {
    if (status !== "ready" || !window.google?.maps) return;
    const maps = window.google.maps;

    for (const [id, marker] of markersRef.current) {
      const isSelected = id === selectedId;
      marker.setIcon({
        url: pinIcon(isSelected),
        scaledSize: isSelected ? new maps.Size(32, 42) : new maps.Size(24, 32),
        anchor: isSelected ? new maps.Point(16, 42) : new maps.Point(12, 32),
      });
      // Keep the active pin above its neighbours so a cluster cannot bury it.
      marker.setZIndex(isSelected ? 20 : 1);
    }
  }, [selectedId, status]);

  // Escape closes the preview — the keyboard equivalent of tapping the map.
  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const dismiss = useCallback(() => setSelectedId(null), []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-navy-900/60">
      {/* The map surface. Always mounted so the SDK has a node to attach to. */}
      <div ref={containerRef} className="h-full w-full" aria-hidden={status !== "ready"} />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-900/70">
          <Loader2 className="h-5 w-5 animate-spin text-cyan/80" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-400">Loading map…</p>
        </div>
      )}

      {status === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">Map could not be loaded</p>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">
              The list view has every one of these listings, with the same filters
              applied.
            </p>
          </div>
        </div>
      )}

      {/* How much of the result set the map can actually speak for. Stated rather
          than hidden: a map showing 4 of 12 results is misleading unless it says so. */}
      {status === "ready" && missingCount > 0 && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center sm:justify-start">
          <p className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-navy-950/80 px-3 py-1.5 text-[11px] font-medium text-slate-300 backdrop-blur-md">
            <MapPin className="h-3 w-3 shrink-0 text-cyan/70" aria-hidden="true" />
            <span className="tabular">{missingCount}</span> of{" "}
            <span className="tabular">{listings.length}</span> have no map pin
          </p>
        </div>
      )}

      {status === "ready" && plottable.length === 0 && listings.length > 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-900/70 px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">
              None of these listings has a map pin yet
            </p>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">
              Switch to the list to see all {listings.length} of them.
            </p>
          </div>
        </div>
      )}

      {/* The preview. Anchored to the bottom on every size — on a phone it is a
          sheet across the full width, on a desktop a card in the corner — so it
          never covers the pin the visitor just tapped. */}
      {selected && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 sm:inset-x-auto sm:left-3 sm:bottom-3 sm:w-[22rem]">
          <MapMarkerPreview
            listing={selected}
            saved={savedIds.has(selected.id)}
            signedIn={signedIn}
            redirectTo={redirectTo}
            onDismiss={dismiss}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A dark map style, so the map reads as part of the product rather than a white
 * rectangle punched through it.
 *
 * Hand-written rather than pulled from a style service: it is a dozen rules, it
 * needs no key, and a JSON style array cannot be affected by a remote change.
 * Labels stay legible — the point is a dark base, not an unreadable one.
 */
const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#334155" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#cbd5e1" }],
  },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#14342b" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
];
