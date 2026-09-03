"use client";

import dynamic from "next/dynamic";
import { Loader2, Map as MapIcon } from "lucide-react";

import { isMapConfigured } from "@/lib/maps/config";
import type { PublicListing } from "@/types";

/**
 * The map half of the Explore split, and the gate in front of it.
 *
 * ── Why the dynamic import is here ──────────────────────────────────────────
 *
 * `ExploreMap` carries the marker lifecycle, the dark style array and the preview
 * card. None of that belongs in the JavaScript a visitor downloads to read a list
 * of properties, and the list is the default view. `next/dynamic` with
 * `ssr: false` puts it in its own chunk, fetched the first time someone switches
 * to the map — which is also the first time the Google SDK is requested, so the
 * whole map subsystem is opt-in at runtime.
 *
 * `ssr: false` is legitimate here specifically because this file is a Client
 * Component (it is not allowed from a Server Component in the App Router), and it
 * is *correct* here rather than merely allowed: the map reads `window`, and a
 * server-rendered shell of it would only be markup that must be thrown away on
 * hydration.
 *
 * ── Why the unconfigured case never reaches the map ─────────────────────────
 *
 * `isMapConfigured()` is checked before the dynamic component is even referenced,
 * so a deployment with no key does not download the map chunk or the SDK. It gets
 * a designed panel that says the list is the complete view — not an empty frame,
 * and not a console error.
 */

const ExploreMap = dynamic(
  () => import("@/components/maps/ExploreMap").then((mod) => mod.ExploreMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-white/10 bg-navy-900/60">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-cyan/80" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-400">Preparing map…</p>
        </div>
      </div>
    ),
  }
);

export function ExploreMapPanel({
  listings,
  savedIds,
  signedIn,
  redirectTo,
}: {
  listings: readonly PublicListing[];
  savedIds: ReadonlySet<string>;
  signedIn: boolean;
  redirectTo: string;
}) {
  if (!isMapConfigured()) {
    return <MapNotConfigured count={listings.length} />;
  }

  return (
    <ExploreMap
      listings={listings}
      savedIds={savedIds}
      signedIn={signedIn}
      redirectTo={redirectTo}
    />
  );
}

/**
 * What stands where the map would be when this deployment has no maps key.
 *
 * Says what is true and what to do about it, and nothing about API keys — a
 * visitor cannot act on that, and the operator is not reading the marketplace.
 * Every listing remains reachable through the list, which is why this is a
 * degraded view rather than a lost feature.
 */
function MapNotConfigured({ count }: { count: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/12 bg-navy-900/40 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <MapIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-200">Map view is unavailable</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-500">
          This site is not configured to display interactive maps. The list has all{" "}
          <span className="tabular">{count}</span>{" "}
          {count === 1 ? "listing" : "listings"}, and every listing page links out to
          Google Maps for directions.
        </p>
      </div>
    </div>
  );
}
