import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Camera, ImageOff, MapPin, Pencil, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { toPublicGallery } from "@/lib/media/serialize";
import { MAX_IMAGES_PER_PROPERTY } from "@/lib/media/constants";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/properties/constants";
import { formatPriceWithPeriod, formatShortLocation } from "@/lib/properties/format";
import { cn } from "@/lib/utils/cn";

/**
 * `/dashboard/properties` — the owner's listings, as a way in to each one.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * A read-only index with two ways out of each row: edit the listing's details,
 * or manage its photos. Status changes and deletion live on the edit page rather
 * than here, because both are per-listing decisions with consequences worth
 * reading a sentence about first — and a row of destructive buttons on a list is
 * how the wrong listing gets unpublished.
 *
 * ── Why each card is not one big link ───────────────────────────────────────
 *
 * It was, when photos were the only destination. Two destinations means two
 * links, and nesting them inside an outer anchor is invalid HTML that browsers
 * resolve by silently closing the first one. So the card is a plain container
 * and the two actions are explicit — which also means the title is selectable
 * text rather than something that navigates on a stray click.
 *
 * ── Why the query is here and not behind a fetch ────────────────────────────
 *
 * The listings are read directly with Prisma in a Server Component, the same way
 * `app/dashboard/page.tsx` reads its counts. Going through `/api/properties` would
 * mean an authenticated HTTP round trip to this same process to re-derive the
 * session it already has. The ownership predicate is what matters, and it is
 * identical either way: `ownerId` comes from `getCurrentUser()` and appears in the
 * `where` clause.
 */

/**
 * No pagination yet.
 *
 * A hard `take` instead, because an unbounded `findMany` on a page is a query that
 * gets slower forever. Fifty is far past what any seller in this phase has, and
 * when it is not, the fix is the paginated list the API already supports — not a
 * larger number here.
 */
const MAX_LISTINGS = 50;

export const metadata = {
  title: "My Properties · PROPERTYNEX",
};

export default async function MyPropertiesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard/properties");

  const properties = await prisma.property.findMany({
    // The authorization boundary for this page, in one word.
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: MAX_LISTINGS,
    include: { media: true },
  });

  return (
    <div className="mx-auto max-w-5xl animate-fade-in" style={{ animationFillMode: "both" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">Listings</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            My Properties
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Every listing on your account. Open one to edit its details, publish or unpublish it,
            and arrange the photos buyers see first.
          </p>
        </div>

        <Link
          href="/dashboard/properties/new"
          className="btn-primary mt-1 inline-flex shrink-0 items-center gap-2 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New listing
        </Link>
      </div>

      {properties.length === 0 ? (
        <div className="glass-card edge-glow mt-7 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-slate-300">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold text-white">No listings yet</h2>
          <p className="max-w-md text-sm leading-relaxed text-slate-400">
            Add your first property and it appears here. It all fits on one page, and you can
            save it as a private draft before deciding to publish.
          </p>
          <Link
            href="/dashboard/properties/new"
            className="btn-primary mt-1 inline-flex items-center gap-2 text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add a property
          </Link>
        </div>
      ) : (
        <ul className="mt-7 space-y-4">
          {properties.map((property) => {
            // The same projection the public browse card uses, so "the cover" means
            // one thing across the app: whatever `toPublicGallery` puts first.
            const gallery = toPublicGallery(property.media);
            const cover = gallery[0];
            const location = formatShortLocation(property);

            return (
              <li key={property.id}>
                <div className="glass-card flex gap-4 overflow-hidden p-3 transition-colors duration-300 hover:border-white/20 sm:gap-5 sm:p-4">
                  <Link
                    href={`/dashboard/properties/${property.id}/photos`}
                    className="group relative h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-navy-950/60 sm:h-28 sm:w-36"
                    aria-label={`Photos for ${property.title}`}
                  >
                    {cover ? (
                      /* An unpublished listing's photos are owner-only, and the
                         image optimizer fetches server-side without the session
                         cookie — so `<img>`, not `next/image`. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover.url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 ease-premium group-hover:scale-105"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-slate-500 transition-colors group-hover:text-slate-300">
                        <ImageOff className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white sm:text-base">
                        <Link
                          href={`/dashboard/properties/${property.id}/edit`}
                          className="transition-colors hover:text-cyan"
                        >
                          {property.title}
                        </Link>
                      </h2>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                          STATUS_TONES[property.status]
                        )}
                      >
                        {STATUS_LABELS[property.status]}
                      </span>
                    </div>

                    {location && (
                      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400">
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {location}
                      </p>
                    )}

                    <p className="mt-1.5 text-sm font-semibold text-white tabular">
                      {formatPriceWithPeriod(property.price, property.listingType)}
                    </p>

                    <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5 text-xs">
                      <Link
                        href={`/dashboard/properties/${property.id}/edit`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit details
                      </Link>
                      <Link
                        href={`/dashboard/properties/${property.id}/photos`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                        {gallery.length === 0
                          ? "Add photos"
                          : `${gallery.length} of ${MAX_IMAGES_PER_PROPERTY} photo${
                              gallery.length === 1 ? "" : "s"
                            }`}
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {properties.length === MAX_LISTINGS && (
        <p className="mt-4 text-xs text-slate-500">
          Showing your {MAX_LISTINGS} most recent listings.
        </p>
      )}
    </div>
  );
}
