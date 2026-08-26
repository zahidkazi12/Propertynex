"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

interface ResendControlProps {
  /** Unix ms after which resending is allowed. */
  availableAt: number;
  onResend: () => void;
  sending: boolean;
  /** Resends left after the current one; hides the control at zero. */
  remaining: number;
  disabled?: boolean;
}

/**
 * "Didn't get a code?" with a live cooldown.
 *
 * The remaining time is derived from an absolute timestamp on every render, and
 * the interval only exists to trigger those renders. With no stored counter to
 * fall behind, a throttled background tab or a sleeping device shows the true
 * remaining time on return instead of resuming from where the timer stalled.
 *
 * This is a convenience, not a control: the server enforces the same cooldown
 * and the resend cap independently, so a user who edits the DOM or replays the
 * request just gets a 429.
 */
export function ResendControl({
  availableAt,
  onResend,
  sending,
  remaining,
  disabled = false,
}: ResendControlProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (availableAt === 0) return;

    const id = setInterval(() => {
      setTick((tick) => tick + 1);
      if (availableAt - Date.now() <= 0) clearInterval(id);
    }, 500); // Twice a second, so the displayed value never lags by ~1s.

    return () => clearInterval(id);
  }, [availableAt]);

  const secondsLeft = remainingSeconds(availableAt);

  if (remaining <= 0) {
    return (
      <p className="text-center text-xs text-slate-500">
        You&apos;ve requested the maximum number of codes for this attempt.
      </p>
    );
  }

  const waiting = secondsLeft > 0;

  return (
    <div className="text-center">
      <p className="text-xs text-slate-500">Didn&apos;t get the code?</p>
      <button
        type="button"
        onClick={onResend}
        disabled={waiting || sending || disabled}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan transition-colors hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
        // aria-live so a screen reader hears the control become available
        // instead of having to poll it.
        aria-live="polite"
      >
        {sending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Sending…
          </>
        ) : waiting ? (
          <>Resend in {formatSeconds(secondsLeft)}</>
        ) : (
          <>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Send a new code
          </>
        )}
      </button>
    </div>
  );
}

function remainingSeconds(availableAt: number): number {
  return Math.max(0, Math.ceil((availableAt - Date.now()) / 1000));
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
