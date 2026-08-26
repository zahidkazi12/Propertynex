import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { browseQueryString, type BrowseQuery } from "@/lib/properties/public";

/**
 * Previous / next plus a window of page numbers.
 *
 * Links, not buttons, and every one carries the current filters through
 * `browseQueryString` — so a filtered page 3 is a URL you can share, and the
 * back button steps through pages the way a visitor expects.
 *
 * The window is capped at five entries: a marketplace with fifty pages should
 * not render fifty links, and the ends are always reachable through the
 * first/last entries the window clamps to.
 */

const WINDOW = 5;

function pageWindow(current: number, pageCount: number): number[] {
  const half = Math.floor(WINDOW / 2);
  // Clamp so the window keeps its full width at both ends rather than shrinking
  // to three entries on page 1.
  const start = Math.max(1, Math.min(current - half, pageCount - WINDOW + 1));
  const end = Math.min(pageCount, start + WINDOW - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function Pagination({
  basePath,
  query,
  pageCount,
}: {
  basePath: string;
  query: BrowseQuery;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (page: number) => `${basePath}${browseQueryString(query, { page })}`;
  const pages = pageWindow(query.page, pageCount);

  const hasPrev = query.page > 1;
  const hasNext = query.page < pageCount;

  const stepClass =
    "flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-cyan/30 hover:text-white";

  return (
    <nav
      className="mt-12 flex flex-wrap items-center justify-center gap-2"
      aria-label="Listing pages"
    >
      {hasPrev ? (
        <Link href={href(query.page - 1)} rel="prev" className={stepClass}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Link>
      ) : (
        // Rendered rather than omitted so the row does not shift when it appears
        // on page 2. `aria-hidden` keeps a dead control out of the tab order.
        <span
          className="flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.06] px-3.5 text-sm font-medium text-slate-600"
          aria-hidden="true"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </span>
      )}

      <ul className="flex items-center gap-1.5">
        {pages.map((page) => {
          const isCurrent = page === query.page;

          return (
            <li key={page}>
              <Link
                href={href(page)}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={`Page ${page}`}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold tabular transition-all duration-200",
                  isCurrent
                    ? "bg-gradient-b text-white shadow-glow"
                    : "border border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan/30 hover:text-white"
                )}
              >
                {page}
              </Link>
            </li>
          );
        })}
      </ul>

      {hasNext ? (
        <Link href={href(query.page + 1)} rel="next" className={stepClass}>
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span
          className="flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.06] px-3.5 text-sm font-medium text-slate-600"
          aria-hidden="true"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
