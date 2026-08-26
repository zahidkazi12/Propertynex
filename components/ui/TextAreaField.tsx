"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
  /**
   * Shows a live `n / max` counter beside the hint. Only meaningful with
   * `maxLength`, and only worth turning on for a field with a real minimum —
   * a description that must clear 30 characters is one an owner can otherwise
   * only discover is too short by submitting it.
   */
  showCount?: boolean;
}

/**
 * A multi-line twin of `FormField`, sharing its label / hint / error anatomy and
 * the same `input-field` surface so a textarea does not read as a different
 * control from the inputs above it.
 */
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, error, hint, showCount, id, className, ...props }, ref) => {
    const fieldId = id ?? props.name;
    const length = typeof props.value === "string" ? props.value.length : 0;

    return (
      <div>
        <label htmlFor={fieldId} className="field-label">
          {label}
          {props.required && (
            <>
              <span className="ml-0.5 text-cyan" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>

        <textarea
          ref={ref}
          id={fieldId}
          className={cn("input-field resize-y leading-relaxed", className)}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...props}
        />

        {(hint || showCount) && !error && (
          <div className="flex items-start justify-between gap-3">
            <p id={`${fieldId}-hint`} className="field-hint">
              {hint}
            </p>
            {showCount && props.maxLength !== undefined && (
              // Not announced: the count duplicates information the hint already
              // gives in words, and a counter that fires on every keystroke is
              // noise in a screen reader.
              <p className="field-hint shrink-0 tabular" aria-hidden="true">
                {length} / {props.maxLength}
              </p>
            )}
          </div>
        )}

        {error && (
          <p id={`${fieldId}-error`} className="field-error" role="alert">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
    );
  }
);

TextAreaField.displayName = "TextAreaField";
