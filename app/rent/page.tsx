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
  title: "Rent Property — PROPERTYNEX",
  description:
    "Browse homes and commercial spaces available to rent on PROPERTYNEX. Filter live listings by city, monthly budget, property type and configuration.",
};

/** `/rent` — the same browse experience as `/buy`, filtered to `RENT`. See the
 *  notes on `searchParams` and on the session read in `app/buy/page.tsx`. */
export default async function RentPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sorts = availableSorts();
  const query = parseBrowseQuery(await searchParams, {
    lockedIntent: "RENT",
    allowedSorts: sorts,
  });
  const user = await getCurrentUser();
  const result = await browsePublicListings(query, { viewerId: user?.id ?? null });

  return (
    <PageShell>
      <BrowseView
        basePath="/rent"
        query={query}
        result={result}
        signedIn={user !== null}
        sorts={sorts}
        aiAvailable={isAiSearchAvailable()}
      />
    </PageShell>
  );
}
