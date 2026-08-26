import "server-only";
import type { Property, User } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/utils/api-response";
import { getCurrentUser } from "@/lib/auth/session";
import { decidePropertyAccess, isValidObjectId, type PropertyActor } from "@/lib/properties/ownership";

/**
 * The single gate every property route passes through.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 *
 * A property is resolved for a mutation in exactly one way: read the row by id,
 * then compare its stored `ownerId` against the id on the **server-verified
 * session**. Nothing about ownership is ever taken from the request — not from
 * the body, not from a query parameter, not from a header. There is no code
 * path that writes `ownerId` from client input; create sets it from
 * `getCurrentUser()`, and update/delete never touch it at all.
 *
 * That is why the guard returns the row it read. A route that re-fetched the
 * property after the check, or that issued `updateMany({ where: { id } })`
 * without the owner predicate, would reopen the hole the check just closed. The
 * writes below therefore use `where: { id, ownerId }` even *after* the guard has
 * passed — belt and braces against a future edit to the guard, and it makes the
 * ownership predicate visible at the query itself.
 */

export type SessionGuard =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly response: ReturnType<typeof jsonError> };

export type PropertyGuard =
  | {
      readonly ok: true;
      readonly user: User;
      readonly property: Property;
      /** Access granted by the ADMIN override rather than by ownership. */
      readonly viaAdmin: boolean;
    }
  | { readonly ok: false; readonly response: ReturnType<typeof jsonError> };

/** 401 for "no live session". Deliberately distinct from the 404 that a
 *  property you may not touch produces. */
export async function requireSession(): Promise<SessionGuard> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: jsonError("You must be logged in.", 401) };
  }
  return { ok: true, user };
}

const NOT_FOUND_MESSAGE = "That property could not be found.";

/**
 * Session + id shape + existence + ownership, in one call.
 *
 * A malformed id, a deleted row and another user's row all produce the same 404
 * with the same message — see `lib/properties/ownership.ts` for why.
 */
export async function requireOwnedProperty(rawId: string): Promise<PropertyGuard> {
  const session = await requireSession();
  if (!session.ok) return session;

  if (!isValidObjectId(rawId)) {
    return { ok: false, response: jsonError(NOT_FOUND_MESSAGE, 404) };
  }

  const property = await prisma.property.findUnique({ where: { id: rawId } });
  const decision = decidePropertyAccess(property, session.user);

  if (!decision.ok || !property) {
    return { ok: false, response: jsonError(NOT_FOUND_MESSAGE, 404) };
  }

  return { ok: true, user: session.user, property, viaAdmin: decision.viaAdmin };
}

/**
 * The page-level equivalent: returns the row or null, for callers that respond
 * with `notFound()` instead of JSON. Same rule, same "not yours is invisible"
 * outcome.
 */
export async function findAccessibleProperty(
  rawId: string,
  actor: PropertyActor
): Promise<Property | null> {
  if (!isValidObjectId(rawId)) return null;

  const property = await prisma.property.findUnique({ where: { id: rawId } });
  const decision = decidePropertyAccess(property, actor);
  return decision.ok ? property : null;
}
