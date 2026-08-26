"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { STATUS_DESCRIPTIONS, STATUS_LABELS, STATUS_TONES } from "@/lib/properties/constants";
import { availableTransitions, type StatusTransition } from "@/lib/properties/status";
import { cn } from "@/lib/utils/cn";
import type { ApiErrorResponse, SafeProperty } from "@/types";
import type { PropertyStatus } from "@prisma/client";

/**
 * The lifecycle controls for one listing: every status change the actor is
 * allowed to make from where the listing currently is, plus deletion.
 *
 * ── Why the buttons are derived, not written out ────────────────────────────
 *
 * `availableTransitions()` is the same function `POST /api/properties/[id]/status`
 * enforces with. Rendering from it means the UI cannot offer a move the server
 * will refuse (a 403 the owner did nothing to deserve), and cannot hide one it
 * would allow. A new row in the table in `lib/properties/status.ts` shows up here
 * with no change to this file — including the two ADMIN review decisions, which
 * appear only for an admin because the filter is by `role`.
 *
 * `role` is passed in from the server component, which read it from the session.
 * It is presentation only: an owner who forges it gets buttons that produce a
 * 403, because the route re-derives the role from the session cookie.
 *
 * ── Why confirmation is inline ──────────────────────────────────────────────
 *
 * Transitions flagged `confirm` in the table swap themselves for a
 * "yes, do it / cancel" pair in place, rather than opening a modal. It is the
 * same beat of thought with no focus trap to get right, and — since these are the
 * transitions that take a listing *offline* — the consequence text stays on
 * screen next to the button that will cause it.
 */

type PropertyStatusPanelProps = {
  property: SafeProperty;
  /** The viewer's role, from the session. Decides whether the ADMIN review
   *  transitions are offered. */
  role: string;
};

export function PropertyStatusPanel({ property, role }: PropertyStatusPanelProps) {
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  /** The transition target currently in flight. */
  const [pending, setPending] = useState<PropertyStatus | null>(null);
  /** The transition target waiting for a second click. */
  const [confirming, setConfirming] = useState<PropertyStatus | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const busy = pending !== null || deleting;
  const transitions = availableTransitions(property.status, role);

  async function changeStatus(target: PropertyStatus) {
    setError(null);
    setConfirming(null);
    setPending(target);

    try {
      const response = await fetch(`/api/properties/${property.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      const data: ApiErrorResponse = await response.json();

      if (!response.ok) {
        setError(data.error ?? "That change could not be applied. Please try again.");
        setPending(null);
        return;
      }

      // The status shown here comes from the server component's props, so the
      // refresh *is* the state update.
      router.refresh();
      setPending(null);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setPending(null);
    }
  }

  async function deleteListing() {
    setError(null);
    setConfirmingDelete(false);
    setDeleting(true);

    try {
      const response = await fetch(`/api/properties/${property.id}`, { method: "DELETE" });
      const data: ApiErrorResponse = await response.json();

      if (!response.ok) {
        setError(data.error ?? "This listing could not be deleted. Please try again.");
        setDeleting(false);
        return;
      }

      // Nothing left to render at this URL. `deleting` stays true through the
      // navigation so the controls cannot be clicked again.
      router.refresh();
      router.push("/dashboard/properties");
    } catch {
      setError("Network error. Please check your connection and try again.");
      setDeleting(false);
    }
  }

  function renderTransition(transition: StatusTransition) {
    const inFlight = pending === transition.to;
    const awaitingConfirm = confirming === transition.to;

    return (
      <div
        key={transition.to}
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            {transition.label}
            {transition.actor === "ADMIN" && (
              <span className="ml-2 rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                Admin
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            {transition.description}
          </p>
        </div>

        {awaitingConfirm ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => changeStatus(transition.to)}
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
            >
              Yes, {transition.label.toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              transition.confirm ? setConfirming(transition.to) : changeStatus(transition.to)
            }
            className="btn-secondary shrink-0 px-3.5 py-1.5 text-xs"
            disabled={busy}
            aria-busy={inFlight}
          >
            {inFlight && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {transition.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="glass-card p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan">Status</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold text-white">This listing is</h2>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            STATUS_TONES[property.status]
          )}
        >
          {STATUS_LABELS[property.status]}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
        {STATUS_DESCRIPTIONS[property.status]}
      </p>

      <div className="mt-5">
        {error && <Alert>{error}</Alert>}

        {transitions.length > 0 ? (
          <div className="space-y-2.5">{transitions.map(renderTransition)}</div>
        ) : (
          <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-400">
            There is nothing to change from here. A reviewer decides what happens next.
          </p>
        )}
      </div>

      <div className="divider-glow my-6" />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Delete this listing</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            Permanent, and it takes the photos and inquiries with it. To take a listing offline
            without losing anything, unpublish it instead.
          </p>
        </div>

        {confirmingDelete ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={deleteListing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/25 disabled:opacity-60"
              disabled={busy}
              aria-busy={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Delete permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs text-red-300 hover:text-red-200"
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>
    </section>
  );
}
