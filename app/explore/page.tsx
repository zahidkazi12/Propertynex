import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { BrowseView } from "@/components/marketplace/BrowseView";
import { isAiSearchAvailable } from "@/lib/ai/provider";
import { getCurrentUser } from "@/lib/auth/session";
import { availableSorts } from "@/lib/properties/ai";
import {
  browsePublicListings,
  parseBrowseQuery,
  type RawSearchParams,
} from "@/lib/properties/public";

export const metadata: Metadata = {
  title: "Explore Property — PROPERTYNEX",
  description:
    "Every live listing on PROPERTYNEX, for sale and to rent. Filter by intent, city, budget, property type and configuration.",
};

/**
 * `/explore` — every live listing, both intents at once.
 *
 * The one browse route that does **not** pass `lockedIntent`, so `intent` is read
 * from the query string and `null` — meaning both — is reachable here and nowhere
 * else. That is what `IntentSwitch`'s "All" tab points at, and what
 * `browse-query.ts` documents as the only page where the intent chip can be
 * cleared rather than merely switched.
 *
 * It is also where a bookmarked `?saved=1` belongs: the saved view spans what a
 * visitor saved, which is not one intent's worth of listings.
 *
 * Everything else is the wiring `/buy` and `/rent` use, unchanged — see the notes
 * on `searchParams` and on the session read in `app/buy/page.tsx`.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // One call, used twice: as the parser's allowlist and as the dropdown's option
  // list, so a hand-typed `?sort=ai-match` and the control can never disagree
  // about whether that sort exists. See lib/properties/ai.ts.
  const sorts = availableSorts();
  const query = parseBrowseQuery(await searchParams, { allowedSorts: sorts });
  const user = await getCurrentUser();
  const result = await browsePublicListings(query, { viewerId: user?.id ?? null });

  return (
    <PageShell>
      <BrowseView
        basePath="/explore"
        query={query}
        result={result}
        signedIn={user !== null}
        sorts={sorts}
        aiAvailable={isAiSearchAvailable()}
      />
    </PageShell>
  );
}
