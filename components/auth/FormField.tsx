"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, hint, id, ...props }, ref) => {
    const fieldId = id ?? props.name;
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
        <input
          ref={ref}
          id={fieldId}
          className="input-field"
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...props}
        />
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

FormField.displayName = "FormField";
