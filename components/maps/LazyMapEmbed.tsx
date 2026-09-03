"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

/**
 * A Google map for one listing, as a lazily-mounted iframe.
 *
 * ── Why an iframe and not the JavaScript SDK ────────────────────────────────
 *
 * This surface needs exactly one pin and no interaction beyond pan and zoom. The
 * Maps Embed API delivers that from a plain `<iframe src>` — a real Google map,
 * with the marker placed by the `q` parameter, and no `google.maps` namespace on
 * the page at all. So a visitor reading a listing never downloads the SDK, and
 * `lib/maps/loader.ts` stays unused outside Explore. That is the cheapest correct
 * answer to "show a map here", and it means the two map surfaces cannot fight
 * over a shared SDK instance because only one of them has one.
 *
 * ── Two levels of laziness ─────────────────────────────────────────────────
 *
 * The location section sits well below the fold, past the gallery and the facts,
 * so most visitors never reach it. The iframe is therefore not rendered at all
 * until an `IntersectionObserver` says it is near the viewport, and it carries
 * `loading="lazy"` as a second line of defence for browsers that begin fetching
 * before paint. Until then the slot holds a reserved-height placeholder, so
 * mounting the map cannot shift the page: the layout box is identical before and
 * after, which is what keeps this section out of the page's CLS.
 *
 * ── Why the container has a fixed aspect ratio ─────────────────────────────
 *
 * An iframe with a percentage height inside an auto-height parent collapses to
 * zero. The wrapper sets the box with `aspect-[4/3] sm:aspect-[16/9]` and the
 * iframe fills it absolutely, which both prevents the collapse and reserves the
 * space up front.
 */

export function LazyMapEmbed({
  src,
  title,
}: {
  /** A `https://www.google.com/maps/embed/v1/...` URL from `lib/maps/links.ts`. */
  src: string;
  /** Names the frame for assistive technology — an iframe with no title is an
   *  unlabelled document in the accessibility tree. */
  title: string;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const node = slotRef.current;
    if (!node) return;

    // No observer (very old browser, or a test environment): show the map rather
    // than withholding it. Degrading to "no map" would be a worse failure than
    // loading it eagerly.
    //
    // Scheduled rather than set here, for two reasons. Flipping state synchronously
    // in an effect body is the cascading-render pattern `react-hooks` rejects, and
    // the obvious alternative — a lazy `useState` initialiser that feature-detects —
    // is worse: this component is server-rendered, `IntersectionObserver` is always
    // undefined in Node, so the initialiser would return `true` on the server and
    // `false` in the browser and hydration would mismatch on every listing page.
    // A task later, on the client only, both mounts the iframe and keeps the two
    // renders agreeing.
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          // One-shot: once mounted, the iframe stays mounted. Unmounting it on
          // scroll-out would re-request the map every time the section passes the
          // viewport and throw away the user's pan and zoom with it.
          observer.disconnect();
        }
      },
      // Start loading a little before it is actually on screen, so the map is
      // usually painted by the time it is scrolled to.
      { rootMargin: "200px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={slotRef}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-navy-900/60 sm:aspect-[16/9]"
    >
      {visible && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
      )}

      {/* Placeholder, and then loading state. Crossfades out rather than
          disappearing, so the map does not snap into place. `pointer-events-none`
          once loaded keeps a lingering fade from swallowing a drag on the map. */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-900/60 transition-opacity duration-500 ease-premium ${
          loaded ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={loaded}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          {visible ? (
            <Loader2 className="h-5 w-5 animate-spin text-cyan/80" aria-hidden="true" />
          ) : (
            <MapPin className="h-5 w-5 text-cyan/80" aria-hidden="true" />
          )}
        </div>
        <p className="text-xs font-medium text-slate-400">
          {visible ? "Loading map…" : "Map loads as you scroll"}
        </p>
      </div>
    </div>
  );
}
