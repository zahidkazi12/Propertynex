"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Bath, BedDouble, ImageOff, Maximize, ShieldCheck, X } from "lucide-react";

import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { PROPERTY_TYPE_LABELS } from "@/lib/properties/constants";
import { formatArea, formatPrice, formatShortLocation } from "@/lib/properties/format";
import type { PublicListing } from "@/types";

/**
 * The card that appears when a map marker is tapped.
 *
 * ── Why a card and not an InfoWindow ────────────────────────────────────────
 *
 * Google's `InfoWindow` renders inside the map's own DOM with its own chrome, its
 * own white background and its own tail. Styling it into a glass panel means
 * fighting inline styles the SDK rewrites on every open, and its width is bounded
 * by the map viewport in a way that breaks at 320px. This is a plain React node
 * positioned over the map instead: the design system applies to it directly, and
 * on a phone it can be a full-width sheet, which an InfoWindow anchored to a pin
 * cannot.
 *
 * ── What it shows, and why that list stops where it does ────────────────────
 *
 * Image, title, price, location, type, beds/baths, area — enough to decide whether
 * to open the listing, which is the only decision this card exists to support.
 * The description, amenities and seller live on `/property/[id]`, one tap away.
 *
 * ── Motion ─────────────────────────────────────────────────────────────────
 *
 * It enters with a short rise-and-fade, on `transform`/`opacity` only, so the map
 * beneath it never re-layouts. `prefers-reduced-motion` users get the opacity and
 * none of the movement — handled globally in `app/globals.css`.
 */

export function MapMarkerPreview({
  listing,
  saved,
  signedIn,
  redirectTo,
  onDismiss,
}: {
  listing: PublicListing;
  /** Resolved server-side with the result set, so the heart here agrees with the
   *  one on the same listing's card in the list view. */
  saved: boolean;
  signedIn: boolean;
  redirectTo: string;
  onDismiss: () => void;
}) {
  const isRental = listing.listingType === "RENT";
  const cover = listing.images[0] ?? null;

  return (
    <article
      // `pointer-events-auto` because the positioning wrapper disables them, so a
      // dismissed card cannot keep swallowing drags meant for the map.
      className="glass-card edge-glow pointer-events-auto relative animate-fade-in overflow-hidden"
      style={{ animationFillMode: "both", animationDuration: "0.24s" }}
      aria-label={`Preview of ${listing.title}`}
    >
      <div className="flex gap-3 p-3">
        {/* Cover. Fixed box so a portrait and a landscape photo produce the same
            card height and the sheet does not jump between markers. */}
        <div className="relative h-[4.5rem] w-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-navy-900">
          {cover ? (
            <Image
              src={cover.url}
              alt={cover.alt ?? listing.title}
              fill
              sizes="96px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageOff className="h-4 w-4 text-slate-600" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-base font-bold tracking-tight text-white tabular">
                {formatPrice(listing.price)}
              </span>
              {isRental && <span className="text-[11px] text-slate-400">/ mo</span>}
            </p>

            <div className="flex shrink-0 items-center gap-1">
              <FavoriteButton
                propertyId={listing.id}
                initialSaved={saved}
                signedIn={signedIn}
                redirectTo={redirectTo}
              />
              <button
                type="button"
                onClick={onDismiss}
                // 36px box around a 14px glyph: the visual mark is small, the hit
                // area is not.
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition-colors duration-200 hover:border-white/20 hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Close preview</span>
              </button>
            </div>
          </div>

          <h3 className="mt-1 line-clamp-1 text-sm font-semibold text-white">{listing.title}</h3>

          <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
            {formatShortLocation(listing)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.08] px-3 py-2.5">
        <span className="badge-soft">{PROPERTY_TYPE_LABELS[listing.propertyType]}</span>

        {listing.bedrooms !== null && (
          <span className="flex items-center gap-1 text-[11px] text-slate-300">
            <BedDouble className="h-3.5 w-3.5 text-cyan/70" aria-hidden="true" />
            <span className="tabular">{listing.bedrooms}</span> BHK
          </span>
        )}
        {listing.bathrooms !== null && (
          <span className="flex items-center gap-1 text-[11px] text-slate-300">
            <Bath className="h-3.5 w-3.5 text-cyan/70" aria-hidden="true" />
            <span className="tabular">{listing.bathrooms}</span>
          </span>
        )}
        <span className="flex items-center gap-1 text-[11px] text-slate-300">
          <Maximize className="h-3.5 w-3.5 text-cyan/70" aria-hidden="true" />
          <span className="tabular">{formatArea(listing.areaValue, listing.areaUnit)}</span>
        </span>

        {listing.verified && (
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-cyan">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Verified
          </span>
        )}
      </div>

      <div className="px-3 pb-3">
        <Link
          href={`/property/${listing.id}`}
          className="btn-primary group w-full justify-center py-2 text-xs"
        >
          View details
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform duration-300 ease-premium group-hover:translate-x-1"
            aria-hidden="true"
          />
        </Link>
      </div>
    </article>
  );
}
