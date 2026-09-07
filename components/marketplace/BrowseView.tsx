import type { ReactNode } from "react";
import type { ListingType } from "@prisma/client";
import Link from "next/link";
import { ArrowRight, PlugZap, SearchX, Sparkles, Tag, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { ExploreMapPanel } from "@/components/maps/ExploreMapPanel";
import { AiSearchPanel } from "@/components/marketplace/AiSearchPanel";
import { IntentSwitch } from "@/components/marketplace/IntentSwitch";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListingFilters } from "@/components/marketplace/ListingFilters";
import { Pagination } from "@/components/marketplace/Pagination";
import { ViewSwitch } from "@/components/marketplace/ViewSwitch";
import { groupIndian } from "@/lib/properties/format";
import {
  browseQueryString,
  hasActiveFilters,
  type BrowseQuery,
  type BrowseSort,
} from "@/lib/properties/browse-query";
import type { BrowseResult } from "@/lib/properties/public";

/**
 * The body of `/explore`, `/buy` and `/rent`.
 *
 * One component for all three, because they differ only in copy and in the
 * `listingType` they query — `/explore` is the case where that type is *both*.
 * Three near-identical page files would drift the first time a filter or an empty
 * state changed on one of them.
 *
 * ── List and map are one result set ─────────────────────────────────────────
 *
 * `query.view` picks the presentation; it never reaches the `where`. The map is
 * handed `result.listings` — the same array the cards render — so it cannot show a
 * listing the list omits, or omit one the list shows. A visitor who filters in one
 * view and switches to the other is looking at the same properties, which is the
 * only arrangement in which the map is trustworthy.
 *
 * The cards stay visible in map view rather than being replaced by it: the map
 * answers "where", the cards answer "what", and a buyer needs both at once.
 *
 * ── The three empty states, and why they are three ──────────────────────────
 *
 * A grid with nothing in it can mean three different things, and collapsing them
 * into one "no results" message misinforms the visitor in two of the cases:
 *
 *   1. The store is unreachable (`available: false`). Not the visitor's doing and
 *      not permanent — say so, and do not imply the marketplace is empty.
 *   2. Filters excluded everything. The fix is theirs: widen or clear.
 *   3. Nothing is published yet at all. The honest answer is that owners have not
 *      listed anything for this intent — with the invitation to be the first,
 *      rather than filler cards standing in for inventory that does not exist.
 */

/** `ALL` is `/explore`: no intent filter, so the copy cannot name one. */
type IntentKey = ListingType | "ALL";

type IntentCopy = {
  readonly eyebrow: string;
  readonly headingLead: string;
  readonly headingAccent: string;
  readonly sub: string;
  /** "3 properties for sale" / "3 rentals". */
  readonly noun: readonly [singular: string, plural: string];
  readonly emptyTitle: string;
  readonly emptyBody: string;
};

const COPY: Record<IntentKey, IntentCopy> = {
  ALL: {
    eyebrow: "Every live listing",
    headingLead: "Find a place to",
    headingAccent: "call yours",
    sub: "Everything currently listed on PROPERTYNEX, for sale and to rent. Narrow it by intent, city, budget, property type and configuration.",
    noun: ["property", "properties"],
    emptyTitle: "Nothing is listed yet",
    emptyBody:
      "This page shows real listings, so it stays empty until owners publish them. Nothing is being held back — there is simply nothing on PROPERTYNEX right now.",
  },
  BUY: {
    eyebrow: "Properties for sale",
    headingLead: "Find a place to",
    headingAccent: "buy",
    sub: "Every listing here is live on PROPERTYNEX. Filter by city, budget, property type and configuration.",
    noun: ["property for sale", "properties for sale"],
    emptyTitle: "Nothing is listed for sale yet",
    emptyBody:
      "This page shows real listings, so it stays empty until owners publish them. Nothing is being held back — there is simply nothing for sale on PROPERTYNEX right now.",
  },
  RENT: {
    eyebrow: "Properties to rent",
    headingLead: "Find a place to",
    headingAccent: "rent",
    sub: "Live rental listings, with the monthly price, furnishing and locality up front.",
    noun: ["rental", "rentals"],
    emptyTitle: "No rentals are listed yet",
    emptyBody:
      "This page shows real listings, so it stays empty until owners publish them. Nothing is being held back — there is simply nothing to rent on PROPERTYNEX right now.",
  },
};

/** "Showing 1–12 of 34 properties for sale". */
function resultSummary(result: BrowseResult, copy: IntentCopy): string {
  const noun = copy.noun[result.total === 1 ? 0 : 1];
  const firstOnPage = (result.page - 1) * result.perPage + 1;
  const lastOnPage = firstOnPage + result.listings.length - 1;

  if (result.pageCount === 1) {
    return `${groupIndian(result.total)} ${noun}`;
  }
  return `Showing ${groupIndian(firstOnPage)}–${groupIndian(lastOnPage)} of ${groupIndian(result.total)} ${noun}`;
}

/** Shared frame for the three states below — one border, one alignment. */
function EmptyPanel({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card edge-glow relative mt-8 overflow-hidden px-6 py-16 text-center sm:px-12">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-48"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(37,99,235,0.14) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Icon className="h-6 w-6 text-cyan" aria-hidden="true" />
        </div>
        <h3 className="mt-6 text-xl font-bold tracking-tight text-white sm:text-2xl">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{children}</p>
        {action && <div className="mt-8 flex flex-wrap justify-center gap-3">{action}</div>}
      </div>
    </div>
  );
}

export function BrowseView({
  basePath,
  query,
  result,
  signedIn = false,
  sorts,
  aiAvailable = false,
}: {
  basePath: string;
  query: BrowseQuery;
  result: BrowseResult;
  /** Decides whether a heart saves or sends the visitor to log in. */
  signedIn?: boolean;
  /**
   * The sorts this deployment actually offers, from `availableSorts()`.
   *
   * Passed in rather than read from `BROWSE_SORTS` so the dropdown and
   * `parseBrowseQuery`'s `allowedSorts` are the same list from one call — a
   * dropdown offering a sort the parser rejects is an option that silently does
   * nothing, which is the failure `lib/properties/ai.ts` exists to prevent.
   */
  sorts?: readonly BrowseSort[];
  /**
   * Whether an AI provider is configured. Decided on the server — a Client
   * Component reading the environment would inline `undefined` at build time.
   *
   * False renders no assistant at all rather than a broken one: an unconfigured
   * capability is absent, the same posture `ExploreMapPanel` takes without a
   * maps key.
   */
  aiAvailable?: boolean;
}) {
  const copy = COPY[query.intent ?? "ALL"];
  const isFiltered = hasActiveFilters(query);

  // Where the login link on a heart should return to: this page *with* its
  // filters, so a visitor who signs in to save something lands back on the result
  // set they were reading rather than at an unfiltered grid.
  const redirectTo = `${basePath}${browseQueryString(query)}`;

  return (
    <>
      {/* Hero. `pt-28` clears the fixed navbar. */}
      <section className="relative overflow-hidden pb-10 pt-28 sm:pb-12 sm:pt-32">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-[30rem]"
          style={{
            background:
              "radial-gradient(55% 60% at 30% 40%, rgba(37,99,235,0.20) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="shell relative">
          <Reveal className="max-w-3xl">
            <span className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.eyebrow}
            </span>
            <h1 className="mt-6 text-[2.25rem] font-extrabold leading-[1.1] tracking-tight text-white xs:text-5xl lg:text-[3.5rem]">
              {copy.headingLead}{" "}
              <span className="gradient-text">{copy.headingAccent}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              {copy.sub}
            </p>
          </Reveal>

          <Reveal delay={0.08} className="mt-8">
            <IntentSwitch query={query} />
          </Reveal>
        </div>
      </section>

      {/* Filters + results. */}
      <section className="relative pb-20 sm:pb-28">
        <div className="shell">
          {/*
           * The assistant sits above the filter bar, not inside it: it produces
           * a query, the filter bar edits one, and stacking them keeps either
           * usable on its own. `filters` is the page's own query string, so a
           * budget the visitor typed into the form is carried into the AI request
           * and wins there — see lib/ai/merge.ts.
           */}
          {aiAvailable && (
            <AiSearchPanel
              basePath={basePath}
              filters={browseQueryString(query)}
              signedIn={signedIn}
              redirectTo={redirectTo}
            />
          )}

          <ListingFilters basePath={basePath} query={query} sorts={sorts} />

          {result.available && result.total > 0 && (
            <>
              <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  {resultSummary(result, copy)}
                </h2>
                <ViewSwitch basePath={basePath} query={query} />
              </div>

              {query.view === "map" ? (
                /*
                 * Map view. One grid, two children, and the order flips at `lg`:
                 * on a phone the map comes first at a fixed height so it is the
                 * thing you see, with the same cards continuing underneath; on a
                 * desktop the cards take the left column and the map sticks to the
                 * right at viewport height.
                 *
                 * Stacking rather than splitting below `lg` is what keeps 320px free
                 * of horizontal overflow — there is no second column to squeeze.
                 */
                <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-6">
                  <div className="order-first h-[58dvh] min-h-[20rem] lg:order-last lg:sticky lg:top-24 lg:h-[calc(100dvh-9rem)]">
                    <ExploreMapPanel
                      listings={result.listings}
                      savedIds={result.savedIds}
                      signedIn={signedIn}
                      redirectTo={redirectTo}
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-1 xl:grid-cols-2">
                    {result.listings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        saved={result.savedIds.has(listing.id)}
                        signedIn={signedIn}
                        redirectTo={redirectTo}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                  {result.listings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      saved={result.savedIds.has(listing.id)}
                      signedIn={signedIn}
                      redirectTo={redirectTo}
                    />
                  ))}
                </div>
              )}

              <Pagination
                basePath={basePath}
                query={query}
                pageCount={result.pageCount}
              />
            </>
          )}

          {/* 1 — the store could not be reached. */}
          {!result.available && (
            <EmptyPanel icon={PlugZap} title="Listings are temporarily unavailable">
              We could not load listings just now. This is on our side, not yours —
              please try again in a moment.
            </EmptyPanel>
          )}

          {/* 2 — filters excluded everything. */}
          {result.available && result.total === 0 && isFiltered && (
            <EmptyPanel
              icon={SearchX}
              title="No listings match these filters"
              action={
                <Link href={basePath} className="btn-secondary">
                  Clear all filters
                </Link>
              }
            >
              Try widening the price range, choosing a different property type, or
              searching a nearby city.
            </EmptyPanel>
          )}

          {/* 3 — nothing published for this intent at all. */}
          {result.available && result.total === 0 && !isFiltered && (
            <EmptyPanel
              icon={Tag}
              title={copy.emptyTitle}
              action={
                <>
                  <Link href="/sell" className="btn-primary group">
                    List your property
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </Link>
                  <Link href="/signup" className="btn-secondary">
                    Create an account
                  </Link>
                </>
              }
            >
              {copy.emptyBody}
            </EmptyPanel>
          )}
        </div>
      </section>
    </>
  );
}
