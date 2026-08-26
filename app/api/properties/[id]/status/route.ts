import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnedProperty } from "@/lib/properties/access";
import { availableTransitions, canTransition, statusSideEffects } from "@/lib/properties/status";
import { toSafeProperty } from "@/lib/properties/serialize";
import { STATUS_LABELS } from "@/lib/properties/constants";
import { statusChangeSchema } from "@/lib/validation/property";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * `/api/properties/[id]/status` — publish, unpublish, request/decide
 * verification.
 *
 * Status is deliberately not writable through PATCH on the property itself. It
 * lives behind its own endpoint because it is the one field with an
 * authorization rule attached to the *value* rather than to the row: an owner
 * may set PUBLISHED, only an ADMIN may set VERIFIED. Folding it into the edit
 * form's payload would mean every property update had to re-derive that rule.
 *
 * The request names a target status, not an action ("publish"). The transition
 * table in `lib/properties/status.ts` is what decides whether
 * (current → target) is legal for this actor's role, so the set of legal moves
 * is one table rather than a switch statement here that could disagree with the
 * buttons the UI drew from the same table.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  const { property, user } = guard;

  try {
    const body = await request.json();
    const { status: target } = statusChangeSchema.parse(body);

    if (target === property.status) {
      return jsonError(`This listing is already ${STATUS_LABELS[target].toLowerCase()}.`, 409);
    }

    /**
     * The check that matters. `user.role` comes from the database row the
     * session resolved to — never from the request — so a caller cannot claim
     * ADMIN to reach VERIFIED.
     */
    if (!canTransition(property.status, target, user.role)) {
      const allowed = availableTransitions(property.status, user.role)
        .map((transition) => STATUS_LABELS[transition.to])
        .join(", ");

      return jsonError(
        allowed.length > 0
          ? `A ${STATUS_LABELS[
              property.status
            ].toLowerCase()} listing can only move to: ${allowed}.`
          : `A ${STATUS_LABELS[property.status].toLowerCase()} listing cannot be changed.`,
        403
      );
    }

    const updated = await prisma.property.update({
      where: { id: property.id, ownerId: property.ownerId },
      data: {
        status: target,
        ...statusSideEffects(target, property, user.id, new Date()),
      },
    });

    return jsonOk({ property: toSafeProperty(updated) });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("That is not a valid status.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[properties] status change failed:", error);
    return jsonServerError();
  }
}
