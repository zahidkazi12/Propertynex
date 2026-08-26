"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";

interface OtpInputProps {
  /** Digits entered so far. Always a contiguous prefix, never longer than `length`. */
  value: string;
  onChange: (next: string) => void;
  /** Called once when the last digit lands, so the form can submit itself. */
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** id of the element describing this group (hint or error text). */
  describedBy?: string;
  autoFocus?: boolean;
}

/**
 * Segmented passcode entry.
 *
 * Rendered as one input per digit, which is what makes the field legible on a
 * phone, but the model underneath is a single string — the digits are always a
 * contiguous prefix, so there is no way to end up with a gap in the middle that
 * looks complete but isn't.
 *
 * The details that matter for real use:
 *
 *  - `autoComplete="one-time-code"` on the first box. iOS and Android surface
 *    an SMS passcode above the keyboard; without this attribute they don't.
 *  - `inputMode="numeric"` so mobile keyboards open on digits.
 *  - Paste anywhere in the group distributes the digits across the boxes, and
 *    tolerates a pasted "123 456" or a whole "Your code is 123456" fragment.
 *  - Backspace deletes and shifts left the way a normal text field would, so
 *    correcting the third digit of six doesn't mean retyping the rest.
 *  - Focusing a box past the first empty one bounces back to it, which keeps
 *    entry left-to-right no matter where the user taps.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  describedBy,
  autoFocus = false,
}: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  // Guards `onComplete` so it fires on the transition to full, not on every
  // render while the field happens to be full.
  const completedFor = useRef<string | null>(null);

  useEffect(() => {
    if (value.length === length) {
      if (completedFor.current !== value) {
        completedFor.current = value;
        onComplete?.(value);
      }
    } else {
      completedFor.current = null;
    }
  }, [value, length, onComplete]);

  useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
  }, [autoFocus]);

  function focusIndex(index: number) {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  }

  function commit(next: string, focusTo: number) {
    onChange(next.replace(/\D/g, "").slice(0, length));
    focusIndex(focusTo);
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return; // Clearing is handled by Backspace so we can shift left.

    const chars = value.split("");
    for (let k = 0; k < digits.length && index + k < length; k += 1) {
      chars[index + k] = digits[k];
    }
    commit(chars.join(""), index + digits.length);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "Backspace": {
        event.preventDefault();
        if (value[index]) {
          commit(value.slice(0, index) + value.slice(index + 1), index);
        } else if (index > 0) {
          commit(value.slice(0, index - 1) + value.slice(index), index - 1);
        }
        break;
      }
      case "Delete": {
        event.preventDefault();
        if (value[index]) commit(value.slice(0, index) + value.slice(index + 1), index);
        break;
      }
      case "ArrowLeft":
        event.preventDefault();
        focusIndex(index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        focusIndex(index + 1);
        break;
      case "Home":
        event.preventDefault();
        focusIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusIndex(value.length);
        break;
      default:
        break;
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!digits) return;
    event.preventDefault();
    commit(digits.slice(0, length), Math.min(digits.length, length - 1));
  }

  return (
    <div
      role="group"
      aria-label={`${length}-digit passcode`}
      aria-describedby={describedBy}
      // gap-1.5 on the narrowest phones keeps six boxes on one line without
      // shrinking the tap targets below a comfortable size.
      className="flex justify-between gap-1.5 sm:gap-2.5"
    >
      {Array.from({ length }, (_, index) => {
        const digit = value[index] ?? "";
        return (
          <input
            key={index}
            ref={(element) => {
              inputsRef.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            // Only the first box advertises one-time-code: browsers fill the
            // whole value into it, and our paste/change handler spreads it.
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${index + 1}`}
            aria-invalid={invalid || undefined}
            maxLength={length}
            value={digit}
            disabled={disabled}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => {
              // Keep entry left-to-right wherever the user taps.
              if (index > value.length) {
                focusIndex(value.length);
              } else {
                event.currentTarget.select();
              }
            }}
            className={cn(
              "min-w-0 flex-1 rounded-xl border bg-white/[0.04] text-center font-bold text-white",
              "backdrop-blur-md transition-all duration-200 ease-premium tabular-nums",
              "h-12 text-xl xs:h-14 sm:text-2xl",
              "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy-950",
              "focus:scale-[1.04]",
              invalid
                ? "animate-error-shake border-red-500/50 focus:border-red-400 focus:ring-red-400/60"
                : "border-white/10 hover:border-white/20 focus:border-cyan/60 focus:ring-cyan/60",
              digit && !invalid && "border-cyan/40 bg-white/[0.08] shadow-glow-cyan",
              disabled && "cursor-not-allowed opacity-50"
            )}
          />
        );
      })}
    </div>
  );
}
