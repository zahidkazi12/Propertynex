"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SelectOption = { readonly value: string; readonly label: string };
export type SelectGroup = { readonly label: string; readonly options: readonly SelectOption[] };

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Flat option list. Mutually exclusive with `groups`. */
  options?: readonly SelectOption[];
  /** Grouped options, rendered as `<optgroup>`s. */
  groups?: readonly SelectGroup[];
  /** Renders a disabled first option, for "not chosen yet". */
  placeholder?: string;
}

/**
 * A native `<select>`, styled to match `FormField`.
 *
 * Native rather than a custom listbox on purpose: it inherits keyboard support,
 * type-ahead, and — the reason that matters most here — the mobile OS's own
 * wheel picker, which is far easier to use one-handed than any div-based menu
 * for lists as long as the 14 property types.
 *
 * `<option>` elements get explicit colours because the dropdown popup is painted
 * by the OS, not by the page: without them, dark-on-dark makes the list
 * unreadable on Windows Chrome.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, hint, options, groups, placeholder, id, className, ...props }, ref) => {
    const fieldId = id ?? props.name;
    const optionClass = "bg-navy-900 text-white";

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

        <div className="relative">
          <select
            ref={ref}
            id={fieldId}
            className={cn("input-field appearance-none pr-10", className)}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
            }
            {...props}
          >
            {placeholder && (
              <option value="" disabled className={optionClass}>
                {placeholder}
              </option>
            )}

            {options?.map((option) => (
              <option key={option.value} value={option.value} className={optionClass}>
                {option.label}
              </option>
            ))}

            {groups?.map((group) => (
              <optgroup key={group.label} label={group.label} className={optionClass}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value} className={optionClass}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
        </div>

        {hint && !error && (
          <p id={`${fieldId}-hint`} className="field-hint">
            {hint}
          </p>
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

SelectField.displayName = "SelectField";
