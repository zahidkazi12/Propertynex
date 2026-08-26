import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { BrowseView } from "@/components/marketplace/BrowseView";
import {
  browsePublicListings,
  parseBrowseQuery,
  type RawSearchParams,
} from "@/lib/properties/public";

export const metadata: Metadata = {
  title: "Buy Property — PROPERTYNEX",
  description:
    "Browse properties for sale on PROPERTYNEX. Filter live listings by city, budget, property type and configuration.",
};

/**
 * `/buy` — live listings with `listingType: BUY`.
 *
 * `searchParams` is a **Promise** in this version of Next and must be awaited;
 * see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
 * Reading it also opts this route into dynamic rendering, which is what we want:
 * the results depend on both the query string and the current contents of the
 * listings collection, so there is nothing here worth caching at build time.
 *
 * The page itself holds no logic beyond wiring — parsing lives in
 * `parseBrowseQuery`, the query in `browsePublicListings`, the UI in
 * `BrowseView` — so `/buy` and `/rent` cannot drift apart.
 */
export default async function BuyPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseBrowseQuery("BUY", await searchParams);
  const result = await browsePublicListings(query);

  return (
    <PageShell>
      <BrowseView basePath="/buy" query={query} result={result} />
    </PageShell>
  );
}
