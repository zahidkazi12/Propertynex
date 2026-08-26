import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Bath, BedDouble, Layers, MapPin, Maximize, ShieldCheck, UserRound } from "lucide-react";

import { PropertyGallery } from "@/components/media/PropertyGallery";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { PROPERTY_TYPE_LABELS, SELLER_KIND_LABELS } from "@/lib/properties/constants";
import {
  formatArea,
  formatFloor,
  formatPrice,
  formatShortLocation,
} from "@/lib/properties/format";
import type { PublicListing } from "@/types";

/**
 * One listing in a results grid.
 *
 * ── What the card carries, and what it deliberately does not ────────────────
 *
 * The browse spec asks for image, title, price, location, type, beds, baths,
 * area, verification badge, seller and a favorite button — and then says not to
 * overload it. So the card holds exactly those and stops. The description,
 * amenities, floor, furnishing, parking, age and listing date all live on
 * `/property/[id]`, which is what the card links to. It used to hold all of them
 * behind a `<details>` disclosure, because there was no detail page to link to;
 * there is one now, so the disclosure is gone rather than kept as a second,
 * competing way to read a listing.
 *
 * ── Two interactive leaves in a Server Component ────────────────────────────
 *
 * The card renders entirely on the server. The gallery needs a scroll lock and
 * key bindings for its full-screen view, and the heart needs to fire a request,
 * so both are Client Components imported as leaves — the card itself ships no
 * JavaScript.
 *
 * ── Why the link is not the whole card ─────────────────────────────────────
 *
 * A card-wide `<a>` would swallow the two controls inside it: nesting a button
 * inside an anchor is invalid HTML, and a click on the heart would navigate. So
 * the title is the link, stretched over the card's text area with an
 * `absolute inset-0` overlay, and the gallery and the heart sit above it on the
 * z-axis. One tab stop, one accessible name, a large click target, and the
 * controls still work.
 *
 * Every field rendered here comes from `PublicListing`, which is why the card
 * cannot leak an address or a phone number even by accident: those fields are not
 * in the object it receives.
 */

/** A single icon + text fact. `null` text collapses the row entirely, so a plot
 *  does not render an empty bedroom slot. */
function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-slate-300">
      <Icon className="h-4 w-4 shrink-0 text-cyan/70" aria-hidden="true" />
      {children}
    </span>
  );
}

export function ListingCard({
  listing,
  saved = false,
  signedIn = false,
  redirectTo = "/explore",
}: {
  listing: PublicListing;
  /** Has this viewer saved it? Resolved server-side, per page of results. */
  saved?: boolean;
  signedIn?: boolean;
  /** Where the heart's login link should return to. */
  redirectTo?: string;
}) {
  const isRental = listing.listingType === "RENT";
  const sellerKind = listing.seller.kind;
  const floor = formatFloor(listing.floor, listing.totalFloors);

  return (
    <article className="glass-card edge-glow group relative flex flex-col overflow-hidden transition-colors duration-300 ease-premium hover:border-cyan/25">
      {/* `z-10` keeps the gallery's own controls above the stretched title link. */}
      <div className="relative z-10">
        <PropertyGallery images={listing.images} title={listing.title} />

        <div className="absolute right-3 top-3 z-20">
          <FavoriteButton
            propertyId={listing.id}
            initialSaved={saved}
            signedIn={signedIn}
            redirectTo={redirectTo}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {/* Type + verification. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-soft">{PROPERTY_TYPE_LABELS[listing.propertyType]}</span>
          {listing.verified && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Verified
            </span>
          )}
        </div>

        <h3 className="mt-3.5 text-lg font-semibold leading-snug text-white">
          <Link
            href={`/property/${listing.id}`}
            className="line-clamp-2 transition-colors duration-200 group-hover:text-cyan focus-visible:text-cyan"
          >
            {listing.title}
            {/* The stretched hit area. Behind the gallery and the heart (z-10 /
                z-20 above), in front of the text, which has no other links. */}
            <span className="absolute inset-0" aria-hidden="true" />
          </Link>
        </h3>

        <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-400">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            {formatShortLocation(listing)}
            <span className="text-slate-500">, {listing.state}</span>
          </span>
        </p>

        {/* Price. The period is spelled out rather than folded into the number so
            "/month" stays legible at the smaller weight. */}
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold tracking-tight text-white tabular">
            {formatPrice(listing.price)}
          </span>
          {isRental && <span className="text-sm font-medium text-slate-400">/ month</span>}
          {listing.negotiable && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
              Negotiable
            </span>
          )}
        </p>

        {/* Headline facts. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.08] pt-4">
          {listing.bedrooms !== null && (
            <Fact icon={BedDouble}>
              <span className="tabular">{listing.bedrooms}</span> BHK
            </Fact>
          )}
          {listing.bathrooms !== null && (
            <Fact icon={Bath}>
              <span className="tabular">{listing.bathrooms}</span>{" "}
              {listing.bathrooms === 1 ? "bath" : "baths"}
            </Fact>
          )}
          <Fact icon={Maximize}>
            <span className="tabular">{formatArea(listing.areaValue, listing.areaUnit)}</span>
          </Fact>
          {floor && <Fact icon={Layers}>{floor}</Fact>}
        </div>

        {/* Who is offering it. `mt-auto` pins this to the bottom so a row of cards
            lines up regardless of title length. Name only — no id, no contact
            details; see `PublicSeller`. */}
        <p className="mt-auto flex items-center gap-2 pt-4 text-xs text-slate-500">
          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            <span className="text-slate-400">{listing.seller.name}</span>
            {sellerKind && (
              <>
                {" · "}
                {SELLER_KIND_LABELS[sellerKind]}
              </>
            )}
          </span>
        </p>
      </div>
    </article>
  );
}
