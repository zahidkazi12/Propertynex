import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonError(message: string, status: number, fieldErrors?: Record<string, string>) {
  return NextResponse.json({ error: message, fieldErrors }, { status });
}

export function jsonOk<T extends object>(data: T, status = 200) {
  return NextResponse.json({ ...data }, { status });
}

/**
 * Converts a ZodError into a flat { field: message } map for the client,
 * and never leaks raw error internals (stack traces, server error messages)
 * to the response body — only the explicit `message` string does.
 */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Generic catch-all for unexpected server errors — never exposes internals. */
export function jsonServerError() {
  return jsonError("Something went wrong. Please try again in a moment.", 500);
}
