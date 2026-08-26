"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The save/unsave heart on a listing.
 *
 * ── Why it is optimistic, and what "optimistic" costs ───────────────────────
 *
 * A heart that waits for a round trip before filling in feels broken, so the fill
 * flips immediately and the request follows. The honest cost of that is a window
 * in which the UI is ahead of the database — so the failure path is written
 * first: any non-OK response or network error puts the previous state back and
 * announces why in an `aria-live` region. It does not silently keep the wrong
 * state, which is the failure mode that makes optimistic UI untrustworthy.
 *
 * The reconciled value comes from the response body (`saved`) rather than from
 * the local guess, so a double-tap that races itself settles on what the server
 * actually holds.
 *
 * ── The signed-out case is a link, not a disabled button ────────────────────
 *
 * Saving needs an account. A disabled heart tells a visitor they cannot do
 * something without telling them how to; a link to `/login?redirectTo=…` tells
 * them both, and brings them back to the page they were reading. `redirectTo`
 * carries the current path *and* its query string, so a filtered result page is
 * still filtered when they return.
 *
 * ── Why `router.refresh()` on success ──────────────────────────────────────
 *
 * The saved state lives in the server render — `browsePublicListings` resolves it
 * per page — so the local flip is a display-level guess about a server value.
 * Refreshing after a successful write makes the two agree, which matters most on
 * `?saved=1`, where un-saving a listing should remove the card rather than leave
 * a hollow heart on something the filter no longer includes.
 */

type Size = "sm" | "lg";

const SIZES: Record<Size, { readonly button: string; readonly icon: string }> = {
  sm: { button: "h-9 w-9", icon: "h-[18px] w-[18px]" },
  lg: { button: "h-11 w-11", icon: "h-5 w-5" },
};

export function FavoriteButton({
  propertyId,
  initialSaved,
  signedIn,
  redirectTo,
  size = "sm",
  className,
}: {
  propertyId: string;
  initialSaved: boolean;
  signedIn: boolean;
  /** Where to come back to after logging in. Built on the server. */
  redirectTo: string;
  size?: Size;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const dims = SIZES[size];

  const shell = cn(
    "relative flex shrink-0 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300 ease-premium",
    saved
      ? "border-rose-400/50 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
      : "border-white/15 bg-navy-950/60 text-slate-200 hover:border-rose-400/40 hover:text-rose-300",
    dims.button,
    className
  );

  if (!signedIn) {
    return (
      <Link
        href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
        className={shell}
        aria-label="Log in to save this property"
        title="Log in to save this property"
      >
        <Heart className={dims.icon} aria-hidden="true" />
      </Link>
    );
  }

  async function toggle() {
    if (busy) return;

    const next = !saved;
    // Optimistic: flip now, reconcile below.
    setSaved(next);
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/favorites", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setSaved(!next);
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : "That didn't work. Please try again.";
        setError(message);
        return;
      }

      // The server's answer wins over the guess.
      if (payload && typeof payload === "object" && "saved" in payload) {
        setSaved(Boolean((payload as { saved: unknown }).saved));
      }
      startTransition(() => router.refresh());
    } catch {
      setSaved(!next);
      setError("You appear to be offline. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        // `aria-pressed` rather than a changing label: the control is one toggle,
        // and screen readers announce its state from the attribute.
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved properties" : "Save this property"}
        title={saved ? "Saved" : "Save"}
        className={shell}
      >
        {busy ? (
          <Loader2 className={cn(dims.icon, "animate-spin")} aria-hidden="true" />
        ) : (
          <Heart
            className={cn(dims.icon, "transition-transform duration-300 ease-premium", saved && "scale-110")}
            fill={saved ? "currentColor" : "none"}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Errors are announced but not laid out: the heart sits over a photo, and
          a message box there would cover it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {error ?? ""}
      </span>
    </>
  );
}
