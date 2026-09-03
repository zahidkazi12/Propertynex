import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  IndianRupee,
  Layers,
  Mail,
  MapPin,
  Maximize,
  Phone,
  ShieldCheck,
  Sofa,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { PageShell } from "@/components/layout/PageShell";
import { PropertyGallery } from "@/components/media/PropertyGallery";
import { PropertyLocationSection } from "@/components/maps/PropertyLocationSection";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { InquiryForm } from "@/components/marketplace/InquiryForm";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { Reveal } from "@/components/ui/Reveal";
import { getCurrentUser } from "@/lib/auth/session";
import { findNearbyPlaces } from "@/lib/maps/nearby";
import {
  AMENITY_GROUPS,
  FURNISHING_LABELS,
  PARKING_LABELS,
  PROPERTY_TYPE_LABELS,
  SELLER_KIND_LABELS,
  amenityLabel,
} from "@/lib/properties/constants";
import { favoriteIdsFor } from "@/lib/properties/favorites";
import {
  formatArea,
  formatConfiguration,
  formatDate,
  formatExactPrice,
  formatFloor,
  formatMonthYear,
  formatPrice,
  formatPropertyAge,
  formatShortLocation,
} from "@/lib/properties/format";
import { findPublicListing, findSimilarListings } from "@/lib/properties/public";
import type { PublicListingDetail } from "@/types";

/**
 * `/property/[id]` — one live listing on its own page.
 *
 * ── What a 404 here means, and what it deliberately does not distinguish ─────
 *
 * `findPublicListing` constrains on `status: { in: LIVE_STATUSES }` as part of the
 * lookup, so a DRAFT id, a malformed id and an id that was never issued are one
 * answer: null. This page turns all three into the same `notFound()`. That is what
 * stops the URL from becoming an existence oracle for unpublished listings — the
 * same reasoning `lib/properties/ownership.ts` gives for answering 404 rather than
 * 403 on the owner side.
 *
 * ── Why the address is still not here ───────────────────────────────────────
 *
 * A detail page is the obvious place to expect a street address, and it does not
 * have one: `PublicListingDetail` carries locality, city and state and no
 * `addressLine1`, `pincode` or coordinates. Publishing an exact door is a separate
 * product decision with its own consent question, not a side effect of building
 * this page (see `types/index.ts`).
 *
 * ── The one place contact details can appear ────────────────────────────────
 *
 * `listing.seller` is a `PublicSellerContact`, and `phone`/`email` are already
 * gated on the listing's `contactPreference` by `toPublicSellerContact`. This page
 * renders whichever of them is non-null and does not re-derive the rule — there is
 * exactly one gate, in the projection, and duplicating it here is how the two
 * would eventually disagree. `IN_APP` yields neither, and the inquiry form is
 * offered regardless.
 */

/**
 * Memoised for the duration of one request, so `generateMetadata` and the page
 * body share a single lookup instead of issuing the same query twice.
 */
const getListing = cache(findPublicListing);

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);

  if (!listing) {
    return { title: "Listing not found — PROPERTYNEX" };
  }

  const where = formatShortLocation(listing);
  const price = formatPrice(listing.price);
  const kind = PROPERTY_TYPE_LABELS[listing.propertyType];
  const intent = listing.listingType === "RENT" ? "for rent" : "for sale";

  return {
    title: `${listing.title} — PROPERTYNEX`,
    description: `${kind} ${intent} in ${where}, ${listing.state}. ${price}${
      listing.listingType === "RENT" ? " per month" : ""
    }.`,
  };
}

/** One icon + label + value row in the facts panel. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
        <Icon className="h-4 w-4 text-cyan/80" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <span className="mt-0.5 block text-sm font-medium text-slate-200">{children}</span>
      </span>
    </div>
  );
}

/**
 * The listing's amenities, in the order `AMENITY_GROUPS` declares them.
 *
 * Grouped rather than listed flat because twenty chips in storage order read as a
 * pile; grouped by the same headings the owner chose them under, they read as a
 * spec. Any slug the allowlist no longer knows still renders — `amenityLabel`
 * falls back to the slug — under a final "Other" heading, so a retired amenity on
 * an old row is visible rather than silently dropped.
 */
function amenitySections(amenities: readonly string[]) {
  const remaining = new Set(amenities);

  const sections = AMENITY_GROUPS.map((group) => {
    const present = group.amenities
      .filter((amenity) => remaining.has(amenity.value))
      .map((amenity) => {
        remaining.delete(amenity.value);
        return amenity.label;
      });
    return { label: group.label, items: present };
  }).filter((section) => section.items.length > 0);

  if (remaining.size > 0) {
    sections.push({
      label: "Other",
      items: [...remaining].map(amenityLabel),
    });
  }

  return sections;
}

export default async function PropertyDetailPage({ params }: PageProps) {
  const { id } = await params;

  const listing = await getListing(id);
  if (!listing) notFound();

  // Independent of each other, so they overlap. `findSimilarListings` returns []
  // rather than throwing — "similar properties" is a convenience and the listing is
  // the content.
  const [user, similar] = await Promise.all([getCurrentUser(), findSimilarListings(listing)]);

  // One indexed query covering this listing *and* the similar cards below it, so a
  // listing the viewer has already saved shows a filled heart wherever it appears.
  // Sequential because it needs the ids the previous call produced; free for a
  // signed-out visitor, who short-circuits to an empty set. Swallows its own
  // failures — the hearts are decoration on top of the page, not the page.
  const savedIds = await favoriteIdsFor(user?.id ?? null, [
    listing.id,
    ...similar.map((other) => other.id),
  ]);

  // Asked only when there is a real coordinate to ask about, and answered only
  // when a nearby-places provider is installed. `null` — the shipped state — means
  // the section is omitted rather than shown empty. See `lib/maps/nearby.ts` for
  // why no provider ships and why that is deliberate.
  const nearby = listing.location
    ? await findNearbyPlaces({
        latitude: listing.location.latitude,
        longitude: listing.location.longitude,
      })
    : null;

  const isRental = listing.listingType === "RENT";
  const backHref = isRental ? "/rent" : "/buy";
  const configuration = formatConfiguration(listing.bedrooms, listing.bathrooms);
  const floor = formatFloor(listing.floor, listing.totalFloors);
  const age = formatPropertyAge(listing.propertyAgeYears);
  const amenities = amenitySections(listing.amenities);

  return (
    <PageShell>
      <article className="relative pb-20 pt-28 sm:pb-28 sm:pt-32">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-[26rem]"
          style={{
            background:
              "radial-gradient(55% 60% at 30% 40%, rgba(37,99,235,0.18) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="shell relative">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {isRental ? "All rentals" : "All properties for sale"}
          </Link>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
            {/* ── Main column ─────────────────────────────────────────────── */}
            <div className="min-w-0">
              <Reveal>
                <div className="glass-card edge-glow relative overflow-hidden">
                  <PropertyGallery images={listing.images} title={listing.title} />
                </div>
              </Reveal>

              <Reveal delay={0.06} className="mt-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge-soft">
                    {PROPERTY_TYPE_LABELS[listing.propertyType]}
                  </span>
                  <span className="badge-soft">{isRental ? "For rent" : "For sale"}</span>
                  {listing.verified && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      Verified
                    </span>
                  )}
                </div>

                <h1 className="mt-4 text-[1.75rem] font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                  {listing.title}
                </h1>

                {/* "3 BHK · 2 baths" — the shorthand an Indian listing leads with.
                    Null for a plot or a warehouse, where it would mean nothing. */}
                {configuration && (
                  <p className="mt-2 text-sm font-medium text-cyan/90">{configuration}</p>
                )}

                <p className="mt-3 flex items-start gap-2 text-sm text-slate-400 sm:text-base">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span>
                    {formatShortLocation(listing)}
                    <span className="text-slate-500">, {listing.state}</span>
                  </span>
                </p>
              </Reveal>

              {/* Facts. Each row collapses when the column is null, so a plot does
                  not render an empty bedroom slot. */}
              <Reveal delay={0.1} className="mt-7">
                <div className="glass-card grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
                  {listing.bedrooms !== null && (
                    <Fact icon={BedDouble} label="Bedrooms">
                      <span className="tabular">{listing.bedrooms}</span> BHK
                    </Fact>
                  )}
                  {listing.bathrooms !== null && (
                    <Fact icon={Bath} label="Bathrooms">
                      <span className="tabular">{listing.bathrooms}</span>{" "}
                      {listing.bathrooms === 1 ? "bath" : "baths"}
                    </Fact>
                  )}
                  <Fact icon={Maximize} label="Area">
                    <span className="tabular">
                      {formatArea(listing.areaValue, listing.areaUnit)}
                    </span>
                  </Fact>
                  {floor && (
                    <Fact icon={Layers} label="Floor">
                      {floor}
                    </Fact>
                  )}
                  {listing.furnishing && (
                    <Fact icon={Sofa} label="Furnishing">
                      {FURNISHING_LABELS[listing.furnishing]}
                    </Fact>
                  )}
                  {listing.parking && (
                    <Fact icon={Car} label="Parking">
                      {PARKING_LABELS[listing.parking]}
                    </Fact>
                  )}
                  {age && (
                    <Fact icon={Building2} label="Age">
                      {age}
                    </Fact>
                  )}
                  <Fact icon={CalendarDays} label="Listed">
                    {formatDate(listing.listedAt)}
                  </Fact>
                </div>
              </Reveal>

              <Reveal delay={0.14} className="mt-7">
                <section aria-labelledby="about-heading" className="glass-card p-5 sm:p-6">
                  <h2
                    id="about-heading"
                    className="text-sm font-semibold uppercase tracking-wider text-slate-400"
                  >
                    About this property
                  </h2>
                  {/* `whitespace-pre-line` so the paragraph breaks the owner typed
                      survive; the text itself was control-stripped and collapsed at
                      validation, so this cannot resurrect anything hostile. */}
                  <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                    {listing.description}
                  </p>
                </section>
              </Reveal>

              {amenities.length > 0 && (
                <Reveal delay={0.18} className="mt-7">
                  <section aria-labelledby="amenities-heading" className="glass-card p-5 sm:p-6">
                    <h2
                      id="amenities-heading"
                      className="text-sm font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Amenities
                    </h2>
                    <div className="mt-5 space-y-5">
                      {amenities.map((section) => (
                        <div key={section.label}>
                          <h3 className="text-xs font-semibold text-slate-300">{section.label}</h3>
                          <ul className="mt-2.5 flex flex-wrap gap-2">
                            {section.items.map((item) => (
                              <li key={item} className="badge-soft">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                </Reveal>
              )}

              {/* Location. Last in the column because it is the section a visitor
                  scrolls to once the listing itself has convinced them, and because
                  putting the map below the fold is what lets it load lazily. */}
              <Reveal delay={0.22} className="mt-7">
                <PropertyLocationSection listing={listing} nearby={nearby} />
              </Reveal>
            </div>

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <div className="min-w-0">
              <div className="lg:sticky lg:top-24 lg:space-y-5">
                <Reveal delay={0.06}>
                  <div className="glass-card edge-glow relative overflow-hidden p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-3xl font-bold tracking-tight text-white tabular">
                            {formatPrice(listing.price)}
                          </span>
                          {isRental && (
                            <span className="text-sm font-medium text-slate-400">/ month</span>
                          )}
                        </p>
                        {/* The compact form above is what the market quotes; the
                            exact figure is what a buyer actually needs. */}
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <IndianRupee className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="tabular">{formatExactPrice(listing.price)}</span>
                        </p>
                        {listing.negotiable && (
                          <span className="mt-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            Negotiable
                          </span>
                        )}
                      </div>

                      <FavoriteButton
                        propertyId={listing.id}
                        initialSaved={savedIds.has(listing.id)}
                        signedIn={user !== null}
                        redirectTo={`/property/${listing.id}`}
                        size="lg"
                      />
                    </div>

                    <div className="mt-5 border-t border-white/[0.08] pt-5">
                      <SellerPanel seller={listing.seller} />
                    </div>
                  </div>
                </Reveal>

                <Reveal delay={0.1} className="mt-5 lg:mt-0">
                  <InquiryForm
                    propertyId={listing.id}
                    defaultName={user?.name ?? ""}
                    defaultEmail={user?.email ?? ""}
                    defaultPhone={user?.phone ?? ""}
                  />
                </Reveal>
              </div>
            </div>
          </div>

          {/* ── Similar listings ──────────────────────────────────────────── */}
          {similar.length > 0 && (
            <section aria-labelledby="similar-heading" className="mt-16 sm:mt-20">
              <h2
                id="similar-heading"
                className="text-sm font-semibold uppercase tracking-wider text-slate-400"
              >
                More {isRental ? "rentals" : "properties"} in {listing.city}
              </h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                {similar.map((other) => (
                  <ListingCard
                    key={other.id}
                    listing={other}
                    saved={savedIds.has(other.id)}
                    signedIn={user !== null}
                    redirectTo={`/property/${listing.id}`}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </article>
    </PageShell>
  );
}

/**
 * Who is offering the listing.
 *
 * `phone` and `email` are rendered only when non-null — see the note in the page
 * header about where that decision is actually made. When both are null the panel
 * says so in words rather than leaving a gap, because "the seller prefers in-app
 * contact" is information, and an absent row looks like a bug.
 */
function SellerPanel({ seller }: { seller: PublicListingDetail["seller"] }) {
  const hasDirectContact = seller.phone !== null || seller.email !== null;

  return (
    <>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Listed by
      </h2>

      <div className="mt-3 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
          <UserRound className="h-4 w-4 text-slate-300" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{seller.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {seller.kind && <>{SELLER_KIND_LABELS[seller.kind]} · </>}
            On PROPERTYNEX since {formatMonthYear(seller.memberSince)}
          </p>
        </div>
      </div>

      {hasDirectContact ? (
        <ul className="mt-4 space-y-2">
          {seller.phone && (
            <li>
              <a
                href={`tel:${seller.phone}`}
                className="flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-cyan"
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-cyan/70" aria-hidden="true" />
                <span className="truncate tabular">{seller.phone}</span>
              </a>
            </li>
          )}
          {seller.email && (
            <li>
              <a
                href={`mailto:${seller.email}`}
                className="flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-cyan"
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-cyan/70" aria-hidden="true" />
                <span className="truncate">{seller.email}</span>
              </a>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          This seller prefers to be contacted through PROPERTYNEX. Use the form
          below and it will reach them directly.
        </p>
      )}
    </>
  );
}
