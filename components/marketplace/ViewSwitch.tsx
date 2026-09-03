"use client";

import Link from "next/link";
import { LayoutGrid, Map as MapIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import {
  BROWSE_VIEWS,
  browseQueryString,
  type BrowseQuery,
  type BrowseView,
} from "@/lib/properties/browse-query";

/**
 * List / Map switch for the browse pages.
 *
 * ── Links, not buttons ──────────────────────────────────────────────────────
 *
 * The view lives in the URL (`?view=map`), so switching it is a navigation and the
 * control is a pair of `<Link>`s. That buys the browser's own affordances for
 * free: the back button returns to the previous view, both views are shareable,
 * and each is a real destination rather than a piece of component state that
 * vanishes on reload. It also means the switch works before hydration.
 *
 * `browseQueryString` builds the target, so every active filter, the sort and the
 * page survive the switch — the two views are two presentations of one result set,
 * and the URL says so.
 *
 * ── Why the page resets to 1 on the switch ─────────────────────────────────
 *
 * The map frames the markers it is given, and page 7 of a filtered set is an
 * arbitrary dozen of them. Landing on the first page makes the map's camera mean
 * something. Going back to the list keeps that reset rather than restoring page 7,
 * because silently returning someone to a page they cannot see the map version of
 * is more confusing than starting at the top.
 *
 * ── Motion ─────────────────────────────────────────────────────────────────
 *
 * The active pill is a positioned sibling that slides between the two options with
 * a transform, so nothing re-layouts and the movement reads as one object moving
 * rather than two backgrounds swapping.
 */

const OPTIONS: Record<BrowseView, { readonly label: string; readonly icon: LucideIcon }> = {
  list: { label: "List", icon: LayoutGrid },
  map: { label: "Map", icon: MapIcon },
};

export function ViewSwitch({
  basePath,
  query,
  className,
}: {
  basePath: string;
  query: BrowseQuery;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md",
        className
      )}
      role="group"
      aria-label="Result view"
    >
      {/* The sliding indicator. `aria-hidden` — the state it visualises is already
          announced by `aria-current` on the active link. */}
      <span
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-gradient-brand transition-transform duration-300 ease-premium",
          query.view === "map" && "translate-x-full"
        )}
        aria-hidden="true"
      />

      {BROWSE_VIEWS.map((view) => {
        const { label, icon: Icon } = OPTIONS[view];
        const active = query.view === view;

        return (
          <Link
            key={view}
            href={`${basePath}${browseQueryString(query, { view, page: 1 })}`}
            aria-current={active ? "true" : undefined}
            // `min-h-11` keeps the target at 44px even though the pill looks
            // slimmer than that.
            className={cn(
              "relative z-10 flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors duration-200",
              active ? "text-white" : "text-slate-400 hover:text-white"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
