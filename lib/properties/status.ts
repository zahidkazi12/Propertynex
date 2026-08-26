/**
 * The listing lifecycle.
 *
 * One transition table, consulted by both the server (which enforces it) and
 * the UI (which renders exactly the buttons it permits). Client-safe: the enum
 * import is type-only and therefore erased.
 *
 * ── The table ───────────────────────────────────────────────────────────────
 *
 *              ┌──────────────┐  publish   ┌───────────┐
 *              │    DRAFT     │───────────▶│ PUBLISHED │
 *              └──────────────┘            └───────────┘
 *                 ▲   │                        │
 *      revert     │   │ request                │ unpublish
 *      / withdraw │   ▼ verification           ▼
 *              ┌──────────────────────┐    ┌─────────────┐
 *              │ PENDING_VERIFICATION │◀───│ UNPUBLISHED │
 *              └──────────────────────┘    └─────────────┘
 *                 │ ADMIN ONLY               ▲        │ publish
 *                 ▼                          │        ▼
 *              ┌──────────┐  unpublish       │   (PUBLISHED)
 *              │ VERIFIED │──────────────────┘
 *              └──────────┘
 *
 * ── Two deliberate decisions ────────────────────────────────────────────────
 *
 * 1. **VERIFIED is admin-only, from PENDING_VERIFICATION alone.** No code path
 *    sets it implicitly — not on create, not on publish, not on edit. There is
 *    no automated verification in this milestone, so a listing can only become
 *    VERIFIED because a `Role.ADMIN` account acted on it, and that act stamps
 *    `verifiedAt` / `verifiedById`. This mirrors the contract written into
 *    `prisma/schema.prisma`.
 *
 * 2. **PUBLISHED cannot go straight to PENDING_VERIFICATION.** Verification
 *    takes a listing offline while it is reviewed, and silently pulling a live
 *    listing down as a side effect of "request verification" is a surprise the
 *    owner did not ask for. The owner unpublishes first — two explicit steps,
 *    no hidden takedown. `UNPUBLISHED` and `DRAFT` (both already offline) are
 *    the states that can enter review.
 *
 * An edit never changes status. A PUBLISHED listing stays published when its
 * price changes; a VERIFIED one keeps its badge. Re-review on edit would be a
 * reasonable product rule, but it is not implemented, so it is not implied.
 */
import type { PropertyStatus, Role } from "@prisma/client";

/** Who may perform a transition. `ADMIN` transitions are refused for owners. */
export type TransitionActor = "OWNER" | "ADMIN";

export type StatusTransition = {
  readonly to: PropertyStatus;
  /** Button/menu label shown to the actor. */
  readonly label: string;
  /** One line of consequence, shown next to the control. */
  readonly description: string;
  readonly actor: TransitionActor;
  /** Transitions that take a listing offline or need a beat of thought get a
   *  confirmation step in the UI. */
  readonly confirm: boolean;
};

/**
 * The single source of truth. Anything not listed here is refused — the check
 * is an allowlist lookup, never a "not one of the forbidden ones" test.
 */
export const STATUS_TRANSITIONS: Record<PropertyStatus, readonly StatusTransition[]> = {
  DRAFT: [
    {
      to: "PUBLISHED",
      label: "Publish",
      description: "Make this listing live.",
      actor: "OWNER",
      confirm: false,
    },
    {
      to: "PENDING_VERIFICATION",
      label: "Request verification",
      description: "Send to PROPERTYNEX for review. Stays offline until reviewed.",
      actor: "OWNER",
      confirm: true,
    },
  ],
  PUBLISHED: [
    {
      to: "UNPUBLISHED",
      label: "Unpublish",
      description: "Take this listing offline. Nothing is deleted.",
      actor: "OWNER",
      confirm: true,
    },
  ],
  UNPUBLISHED: [
    {
      to: "PUBLISHED",
      label: "Publish",
      description: "Put this listing back online.",
      actor: "OWNER",
      confirm: false,
    },
    {
      to: "PENDING_VERIFICATION",
      label: "Request verification",
      description: "Send to PROPERTYNEX for review.",
      actor: "OWNER",
      confirm: true,
    },
    {
      to: "DRAFT",
      label: "Move to draft",
      description: "Park this listing as a draft.",
      actor: "OWNER",
      confirm: false,
    },
  ],
  PENDING_VERIFICATION: [
    {
      to: "DRAFT",
      label: "Withdraw request",
      description: "Cancel the verification request and keep editing.",
      actor: "OWNER",
      confirm: false,
    },
    {
      to: "VERIFIED",
      label: "Approve verification",
      description: "Mark as verified by PROPERTYNEX and publish it.",
      actor: "ADMIN",
      confirm: true,
    },
    {
      to: "UNPUBLISHED",
      label: "Reject verification",
      description: "Return the listing to the owner, offline.",
      actor: "ADMIN",
      confirm: true,
    },
  ],
  VERIFIED: [
    {
      to: "UNPUBLISHED",
      label: "Unpublish",
      description: "Take this listing offline. Re-review is needed to restore the badge.",
      actor: "OWNER",
      confirm: true,
    },
  ],
};

export function isAdminRole(role: Role | string): boolean {
  return role === "ADMIN";
}

/**
 * Transitions the given actor may perform from `from`.
 *
 * An admin sees the owner transitions too — an admin acting on a listing can do
 * anything its owner can, plus the two review decisions.
 */
export function availableTransitions(
  from: PropertyStatus,
  role: Role | string
): readonly StatusTransition[] {
  const admin = isAdminRole(role);
  return STATUS_TRANSITIONS[from].filter(
    (transition) => transition.actor === "OWNER" || admin
  );
}

/**
 * The authorization decision for a status change, as a pure function so it is
 * unit-testable without a database or a session.
 */
export function canTransition(
  from: PropertyStatus,
  to: PropertyStatus,
  role: Role | string
): boolean {
  return availableTransitions(from, role).some((transition) => transition.to === to);
}

/** Which statuses count as "live" — the set the public marketplace will read. */
export const LIVE_STATUSES: readonly PropertyStatus[] = ["PUBLISHED", "VERIFIED"];

export function isLive(status: PropertyStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/**
 * The timestamp columns a transition stamps, as a plain patch object.
 *
 * Kept next to the table rather than inline in the route so that "what does
 * publishing actually record?" has one answer. `publishedAt` is set on the
 * *first* time a listing goes live and preserved after that: it is the listing's
 * original publication date, not the date of the most recent republish.
 */
export function statusSideEffects(
  to: PropertyStatus,
  current: { publishedAt: Date | null },
  actorId: string,
  now: Date
): {
  publishedAt?: Date;
  verificationRequestedAt?: Date;
  verifiedAt?: Date;
  verifiedById?: string;
} {
  switch (to) {
    case "PUBLISHED":
      return current.publishedAt ? {} : { publishedAt: now };
    case "PENDING_VERIFICATION":
      return { verificationRequestedAt: now };
    case "VERIFIED":
      return {
        verifiedAt: now,
        verifiedById: actorId,
        ...(current.publishedAt ? {} : { publishedAt: now }),
      };
    case "DRAFT":
    case "UNPUBLISHED":
      // Stamps are history, not state: an unpublished listing that was once
      // verified keeps `verifiedAt` so a re-review can see it happened before.
      return {};
  }
}
