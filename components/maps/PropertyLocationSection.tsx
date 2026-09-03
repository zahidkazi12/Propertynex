import {
  Compass,
  ExternalLink,
  Hospital,
  MapPin,
  Navigation,
  Plane,
  School,
  ShoppingBag,
  TrainFront,
  TramFront,
  type LucideIcon,
} from "lucide-react";

import { LazyMapEmbed } from "@/components/maps/LazyMapEmbed";
import { MAPS_BROWSER_KEY, MAP_DEFAULTS, isMapConfigured } from "@/lib/maps/config";
import { directionsUrl, embedMapUrl, hasMapTarget, placeUrl, type MapTarget } from "@/lib/maps/links";
import type { NearbyCategory, NearbyPlace } from "@/lib/maps/nearby";
import {
  LOCATION_PRECISION_BADGES,
  LOCATION_PRECISION_HINTS,
} from "@/lib/properties/constants";
import { publicMapAddress } from "@/lib/properties/location";
import type { PublicListingDetail } from "@/types";

/**
 * The Location section of `/property/[id]`.
 *
 * ── Four states, and why none of them is a broken map ───────────────────────
 *
 * Two independent facts decide what renders: does this listing have a publishable
 * coordinate, and does this deployment have a maps key. That is four combinations,
 * and each has a designed answer rather than a failure:
 *
 *   coords + key   → the interactive map, plus directions to the exact point.
 *   coords, no key → no map frame at all; the locality, the precision note, and
 *                    directions that still work, because `lib/maps/links.ts`
 *                    builds Google Maps URLs without a key or an SDK.
 *   no coords, key → same as above. A key cannot conjure a position, and drawing a
 *                    map centred on a city to stand in for a listing would imply a
 *                    pin that does not exist.
 *   neither        → the locality, and an address-based Google Maps link.
 *
 * The one thing that never happens is an empty grey rectangle. A map container
 * with nothing in it reads as a bug the visitor should report; a location panel
 * that says what is known and offers directions reads as a product decision.
 *
 * ── Why directions are here rather than in a client component ───────────────
 *
 * The whole action is an `<a href>` to a Google Maps URL Scheme link. It needs no
 * JavaScript, works identically on desktop and mobile — where the OS hands the
 * URL to the installed Maps app — and therefore ships as plain server-rendered
 * markup that functions before hydration and with scripting disabled.
 *
 * ── Why `nearby` is a prop and not a fetch ─────────────────────────────────
 *
 * The page awaits `findNearbyPlaces` and passes the answer down, so this stays a
 * synchronous component. Two reasons. It keeps data fetching in the route that
 * already does it, next to the listing lookup it depends on; and it avoids an
 * async component appearing inside JSX, which the React 18 type definitions this
 * project pins do not uniformly accept.
 */

const NEARBY_ICONS: Record<NearbyCategory, LucideIcon> = {
  TRANSIT_RAIL: TrainFront,
  TRANSIT_METRO: TramFront,
  AIRPORT: Plane,
  HOSPITAL: Hospital,
  SCHOOL: School,
  SHOPPING: ShoppingBag,
};

export function PropertyLocationSection({
  listing,
  nearby,
}: {
  listing: PublicListingDetail;
  /**
   * `null` means this deployment has no nearby-places provider, and the section is
   * omitted. `[]` means a provider answered and found nothing notable, which is a
   * different statement and is rendered as one. See `lib/maps/nearby.ts`.
   */
  nearby: readonly NearbyPlace[] | null;
}) {
  const address = publicMapAddress(listing);

  // Coordinates when the precision gate allowed them through, and the coarse
  // address as the fallback query. Never `listing.latitude` — the public type does
  // not carry it, by design.
  const target: MapTarget = {
    latitude: listing.location?.latitude ?? null,
    longitude: listing.location?.longitude ?? null,
    address: address || `${listing.city}, ${listing.state}`,
  };

  const mapConfigured = isMapConfigured();
  const embedSrc = mapConfigured && listing.location
    ? embedMapUrl(
        target,
        MAPS_BROWSER_KEY,
        listing.location.precision === "APPROXIMATE"
          ? MAP_DEFAULTS.approximateZoom
          : MAP_DEFAULTS.detailZoom
      )
    : null;

  const directions = directionsUrl(target);
  const placeLink = placeUrl(target);

  return (
    <section aria-labelledby="location-heading" className="glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2
            id="location-heading"
            className="text-sm font-semibold uppercase tracking-wider text-slate-400"
          >
            Location
          </h2>
          <p className="mt-2 flex items-start gap-2 text-sm text-slate-200">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan/80" aria-hidden="true" />
            <span>{address || `${listing.city}, ${listing.state}`}</span>
          </p>
        </div>

        {listing.location && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
            <Compass className="h-3 w-3 text-cyan/80" aria-hidden="true" />
            {LOCATION_PRECISION_BADGES[listing.location.precision]}
          </span>
        )}
      </div>

      {/* The map, or the state that stands in for it. */}
      <div className="mt-5">
        {embedSrc ? (
          <LazyMapEmbed src={embedSrc} title={`Map showing ${listing.title}`} />
        ) : (
          // We are here only because `embedMapUrl` returned null, and it does that
          // for exactly two reasons: no coordinate to plot, or no key to plot it
          // with. A listing that has a location can only be missing the key.
          <LocationUnavailable
            reason={listing.location ? "no-key" : "no-coordinates"}
            address={address || `${listing.city}, ${listing.state}`}
          />
        )}
      </div>

      {listing.location && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {LOCATION_PRECISION_HINTS[listing.location.precision]}
        </p>
      )}

      {/* Actions. `hasMapTarget` is false only when a listing somehow has neither
          coordinates nor a city, which validation does not allow — but the guard
          keeps a dead button from rendering if it ever happens. */}
      {hasMapTarget(target) && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {directions && (
            <a
              href={directions}
              target="_blank"
              // `noopener` severs `window.opener` so the opened tab cannot script
              // this one; `noreferrer` keeps the listing URL out of Google's
              // referrer log. Both matter more than usual on an outbound link that
              // sits next to a seller's contact details.
              rel="noopener noreferrer"
              className="btn-primary group w-full justify-center sm:w-auto"
            >
              <Navigation
                className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
              Get directions
              <span className="sr-only"> (opens Google Maps in a new tab)</span>
            </a>
          )}

          {placeLink && (
            <a
              href={placeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary w-full justify-center sm:w-auto"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View on Google Maps
            </a>
          )}
        </div>
      )}

      {/* Nearby places. Rendered only when a provider answered. `[]` is a real
          answer ("nothing notable nearby") and is reported as such; `null` — no
          provider — renders nothing at all rather than an empty promise. */}
      {nearby !== null && (
        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            What&rsquo;s nearby
          </h3>

          {nearby.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              Nothing notable was found close to this location.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {nearby.map((item) => {
                const Icon = NEARBY_ICONS[item.category];
                return (
                  <li
                    key={`${item.category}-${item.name}`}
                    className="flex items-center gap-2.5 text-sm text-slate-300"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-cyan/70" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 text-xs text-slate-500 tabular">
                      {item.distanceLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The stand-in for a map that cannot be drawn.
 *
 * Deliberately not styled as an error. It is a bordered panel in the same shape
 * the map would occupy, holding the location that *is* known — so the section
 * keeps its rhythm on the page and the visitor is told which of the two reasons
 * applies without being shown a technical one. "This listing has no pin" is the
 * seller's choice; "this site has no map key" is ours, and neither is the
 * visitor's problem to solve.
 */
function LocationUnavailable({
  reason,
  address,
}: {
  reason: "no-coordinates" | "no-key";
  address: string;
}) {
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/12 bg-navy-900/40 px-6 text-center sm:aspect-[16/9]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-200">
          {reason === "no-coordinates" ? "Map location not available" : "Map preview unavailable"}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
          {reason === "no-coordinates"
            ? "The seller has not pinned this listing on the map. It is listed in " +
              address +
              "."
            : "This site is not configured to display embedded maps. You can still open " +
              address +
              " in Google Maps below."}
        </p>
      </div>
    </div>
  );
}
