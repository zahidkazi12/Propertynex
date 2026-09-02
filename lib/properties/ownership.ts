/**
 * The ownership decision, isolated from the database on purpose.
 *
 * Every mutating property route funnels through `decidePropertyAccess`. Keeping
 * it a pure function of (row, actor) means the authorization rule can be
 * exercised directly in unit tests — including the cases that are awkward to
 * provoke over HTTP, like "the row vanished between the read and the write" —
 * rather than only inferred from integration behaviour.
 *
 * ── Why a missing row and someone else's row give the same answer ───────────
 *
 * Both produce `not_found` (HTTP 404), never `403`. A 403 on someone else's
 * listing confirms that the id exists, which turns the id space into an
 * existence oracle: an attacker walking ids could enumerate how many
 * listings the platform holds and which ids are real, without ever being
 * authorized for one. Returning 404 for "not yours" leaks nothing — from the
 * caller's side an id they may not touch is indistinguishable from an id that
 * was never issued.
 *
 * The same reasoning is why a *malformed* id is answered the same way; the shape
 * check itself lives in `lib/utils/record-id.ts`.
 *
 * The one case that *is* 403 is `not_authenticated` → handled before this
 * function, by the route's session check.
 */
import type { Role } from "@prisma/client";

export function isAdminRole(role: Role | string): boolean {
  return role === "ADMIN";
}

export type PropertyActor = {
  readonly id: string;
  readonly role: Role | string;
};

/** The minimum a row must expose for the decision — deliberately not the whole
 *  `Property`, so tests can hand in a two-field object. */
export type OwnedRow = { readonly ownerId: string };

export type AccessDecision =
  | { readonly ok: true; readonly viaAdmin: boolean }
  | { readonly ok: false; readonly reason: "not_found" };

/**
 * Decides whether `actor` may read or mutate `row`.
 *
 * `viaAdmin` is true when access was granted by the admin override rather than
 * by ownership. Callers use it for audit-shaped decisions (which transitions to
 * offer, what to log) — it is never used to widen what an owner may do.
 */
export function decidePropertyAccess(
  row: OwnedRow | null | undefined,
  actor: PropertyActor
): AccessDecision {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.ownerId === actor.id) return { ok: true, viaAdmin: false };
  if (isAdminRole(actor.role)) return { ok: true, viaAdmin: true };
  return { ok: false, reason: "not_found" };
}
