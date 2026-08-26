import type { ReactNode } from "react";
import type { ListingType } from "@prisma/client";
import Link from "next/link";
import { ArrowRight, PlugZap, SearchX, Sparkles, Tag, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { IntentSwitch } from "@/components/marketplace/IntentSwitch";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListingFilters } from "@/components/marketplace/ListingFilters";
import { Pagination } from "@/components/marketplace/Pagination";
import { groupIndian } from "@/lib/properties/format";
import { hasActiveFilters, type BrowseQuery, type BrowseResult } from "@/lib/properties/public";

/**
 * The body of `/buy` and `/rent`.
 *
 * One component for both, because the two pages differ only in copy and in the
 * `listingType` they query. Two near-identical page files would drift the first
 * time a filter or an empty state changed on one of them.
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

const COPY: Record<ListingType, IntentCopy> = {
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
}: {
  basePath: string;
  query: BrowseQuery;
  result: BrowseResult;
}) {
  const copy = COPY[query.listingType];
  const isFiltered = hasActiveFilters(query);

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
          <ListingFilters basePath={basePath} query={query} />

          {result.available && result.total > 0 && (
            <>
              <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  {resultSummary(result, copy)}
                </h2>
                {/* Stated once here rather than as a chip on every card. */}
                <p className="text-xs text-slate-500">
                  Individual listing pages are on the way — for now each card opens
                  its full details in place.
                </p>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                {result.listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>

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
