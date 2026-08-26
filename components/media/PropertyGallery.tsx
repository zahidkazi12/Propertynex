"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Expand, ImageOff, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PublicMedia } from "@/types";

/**
 * The public photo gallery on a browse card.
 *
 * ── Why this is a Client Component and the card is not ──────────────────────
 *
 * `ListingCard` stays a Server Component — it renders the whole published record
 * and must work before hydration. A lightbox cannot: it needs focus handling, key
 * bindings and a scroll lock. So the interactive part is this one leaf, passed the
 * already-projected `PublicMedia[]`, and the card imports it as a child. Nothing
 * else about the card changes runtime.
 *
 * ── Order is the contract ───────────────────────────────────────────────────
 *
 * The array arrives cover-first, in the seller's arrangement — `toPublicGallery`
 * does that once, server-side. This component never re-sorts and never looks for a
 * "primary" flag, because there isn't one to look for: index 0 *is* the cover.
 * That is what makes "the order selected by the seller is preserved" true of the
 * rendered page rather than merely of the database.
 *
 * ── The empty case is a real case ───────────────────────────────────────────
 *
 * Listings created before photos existed have none, and a seller may publish
 * before uploading. That renders a plain placeholder rather than nothing at all,
 * so a grid of cards keeps a consistent height instead of jumping around
 * depending on which sellers got round to it.
 */

/** The aspect ratio every card image is cropped to. 4:3 is the shape most phone
 *  cameras produce, so the crop is usually invisible. */
const FRAME = "aspect-[4/3]";

/**
 * How many thumbnails the strip shows before it stops.
 *
 * The strip is a preview, not the gallery: with twenty photos, twenty
 * six-pixel-wide slivers help nobody. The last visible slot becomes a "+N" button
 * that opens the full-screen view, where every photo is reachable — so nothing is
 * hidden, it is just one tap further away.
 */
const THUMB_SLOTS = 5;

function altFor(image: PublicMedia, index: number, title: string): string {
  // Owner-written alt text wins. The fallback names the listing and the position
  // rather than saying "image", which is what a screen reader would otherwise
  // announce five times in a row.
  return image.alt ?? `${title} — photo ${index + 1}`;
}

export function PropertyGallery({
  images,
  title,
}: {
  images: readonly PublicMedia[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const count = images.length;

  // Wrapping rather than clamping: a gallery with a fixed end is a gallery where
  // the "next" button is dead on the last photo, which reads as broken.
  const step = useCallback(
    (delta: number) => {
      setActive((current) => (count === 0 ? 0 : (current + delta + count) % count));
    },
    [count]
  );

  // Key bindings and the scroll lock belong to the lightbox only — the card itself
  // must not swallow arrow keys while the visitor is scrolling the page.
  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, step]);

  if (count === 0) {
    return (
      <div
        className={cn(
          FRAME,
          "flex w-full flex-col items-center justify-center gap-2 border-b border-white/[0.08] bg-white/[0.02] text-slate-500"
        )}
      >
        <ImageOff className="h-7 w-7" aria-hidden="true" />
        <p className="text-xs font-medium">No photos yet</p>
      </div>
    );
  }

  const current = images[Math.min(active, count - 1)];
  const overflow = count - THUMB_SLOTS;
  const visibleThumbs = overflow > 0 ? images.slice(0, THUMB_SLOTS - 1) : images;

  return (
    <>
      <div className="border-b border-white/[0.08]">
        {/* Cover. A button, not a div with onClick: it is reachable by keyboard and
            announced as an action, which a lightbox trigger has to be. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            FRAME,
            "group relative block w-full overflow-hidden bg-navy-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
          )}
          aria-label={`View ${count} ${count === 1 ? "photo" : "photos"} of ${title} full screen`}
        >
          <Image
            src={current.url}
            alt={altFor(current, active, title)}
            fill
            // One card per row on phones, two at `sm`, three from `lg` — matching the
            // browse grid, so the optimizer is asked for a width close to the one
            // actually painted instead of a full-viewport image on a 3-up desktop grid.
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-premium group-hover:scale-[1.03]"
          />

          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden="true"
          />

          {count > 1 && (
            <span className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-full bg-navy-950/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm tabular">
              {active + 1} / {count}
            </span>
          )}

          <span
            className="pointer-events-none absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-navy-950/70 text-white opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden="true"
          >
            <Expand className="h-4 w-4" />
          </span>
        </button>

        {count > 1 && (
          <div className="flex gap-1.5 p-1.5">
            {visibleThumbs.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show photo ${index + 1}`}
                aria-current={index === active ? "true" : undefined}
                className={cn(
                  "relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-md border transition-all duration-200",
                  index === active
                    ? "border-cyan/70 ring-1 ring-cyan/40"
                    : "border-white/10 opacity-60 hover:opacity-100"
                )}
              >
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            ))}

            {overflow > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActive(THUMB_SLOTS - 1);
                  setOpen(true);
                }}
                className="relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-slate-300 transition-colors duration-200 hover:border-cyan/30 hover:text-white"
                aria-label={`View all ${count} photos full screen`}
              >
                +{overflow + 1}
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex flex-col bg-navy-950/95 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label={`Photos of ${title}`}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <p className="min-w-0 truncate text-sm font-medium text-slate-200">{title}</p>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-400 tabular">
                  {active + 1} / {count}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  autoFocus
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                  aria-label="Close photo viewer"
                >
                  <X className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* The stage. `object-contain` because a full-screen viewer exists to
                show the whole photo — cropping it here would defeat the point. */}
            <div className="relative min-h-0 flex-1">
              <Image
                key={current.id}
                src={current.url}
                alt={altFor(current, active, title)}
                fill
                sizes="100vw"
                className="object-contain"
              />

              {count > 1 && (
                <>
                  {/* Tap targets, not just decorations: 44px minimum, sitting over
                      the left and right edges where a thumb naturally lands. */}
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-navy-900/70 text-white backdrop-blur-sm transition-colors hover:bg-navy-900 sm:left-4"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-navy-900/70 text-white backdrop-blur-sm transition-colors hover:bg-navy-900 sm:right-4"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-6 w-6" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>

            {current.alt && (
              <p className="px-4 pb-1 pt-3 text-center text-xs text-slate-400 sm:px-6">
                {current.alt}
              </p>
            )}

            {count > 1 && (
              <div className="flex gap-2 overflow-x-auto px-4 py-3 sm:justify-center sm:px-6">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setActive(index)}
                    aria-label={`Show photo ${index + 1}`}
                    aria-current={index === active ? "true" : undefined}
                    className={cn(
                      "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border transition-all duration-200",
                      index === active
                        ? "border-cyan/70 ring-1 ring-cyan/40"
                        : "border-white/10 opacity-55 hover:opacity-100"
                    )}
                  >
                    <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
