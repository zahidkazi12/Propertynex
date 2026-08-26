import type { ListingType } from "@prisma/client";
import Link from "next/link";
import { Building2, Key, LayoutGrid, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { browseQueryString, type BrowseQuery } from "@/lib/properties/public";

/**
 * All ⇄ Buy ⇄ Rent, as three links rather than a toggle.
 *
 * This *is* the Buy/Rent filter the browse spec asks for, presented as tabs
 * because in this app the intent is a route: `/explore` shows both, `/buy` and
 * `/rent` pin one each and have their own titles, metadata and copy. A `<button>`
 * that navigated would lose middle-click, "open in new tab" and the browser's own
 * understanding of where it goes — and it would need client state mirroring
 * something the URL already says.
 *
 * Because the intent is the path, `intent` is stripped from the carried query
 * string: `/buy?intent=BUY` is noise, and on `/explore` "all" is the absence of
 * the parameter. `parseBrowseQuery` still *reads* `?intent=` so a hand-written or
 * bookmarked `/explore?intent=RENT` works, and its chip can clear it — but
 * nothing in the UI writes one.
 *
 * Which tab is current is decided from `query.intent`, not from the path, so
 * `/explore?intent=RENT` correctly highlights Rent.
 *
 * The rest of the filters ride along, minus the page number: a search for
 * "Andheri, 2+ BHK" is still what you meant after switching intent, but page 3 of
 * the sale results says nothing about the rental ones.
 */

const INTENTS: ReadonlyArray<{
  readonly key: string;
  readonly intent: ListingType | null;
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { key: "all", intent: null, href: "/explore", label: "All", icon: LayoutGrid },
  { key: "buy", intent: "BUY", href: "/buy", label: "Buy", icon: Building2 },
  { key: "rent", intent: "RENT", href: "/rent", label: "Rent", icon: Key },
];

export function IntentSwitch({ query }: { query: BrowseQuery }) {
  // `page: 1` is omitted by `browseQueryString`, and `intent: null` drops the
  // parameter whether or not the current route had it locked.
  const carried = browseQueryString(query, { page: 1, intent: null });

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md"
      role="group"
      aria-label="Listing intent"
    >
      {INTENTS.map(({ key, intent, href, label, icon: Icon }) => {
        const isCurrent = intent === query.intent;

        return (
          <Link
            key={key}
            href={`${href}${carried}`}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold transition-all duration-300 ease-premium sm:px-5",
              isCurrent
                ? "bg-gradient-b text-white shadow-glow"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
