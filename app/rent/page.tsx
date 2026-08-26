import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { BrowseView } from "@/components/marketplace/BrowseView";
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
 *  note on `searchParams` in `app/buy/page.tsx`. */
export default async function RentPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseBrowseQuery("RENT", await searchParams);
  const result = await browsePublicListings(query);

  return (
    <PageShell>
      <BrowseView basePath="/rent" query={query} result={result} />
    </PageShell>
  );
}
