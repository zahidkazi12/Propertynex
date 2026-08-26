import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnedProperty } from "@/lib/properties/access";
import { toSafeInquiry, toSafeProperty } from "@/lib/properties/serialize";
import { propertyWriteSchema } from "@/lib/validation/property";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * `/api/properties/[id]` — read, update and delete one listing.
 *
 * Every handler starts with `requireOwnedProperty`, which resolves the row and
 * compares its stored `ownerId` against the session. A malformed id, a row that
 * does not exist, and a row belonging to someone else all return the same 404 —
 * see `lib/properties/ownership.ts` for why "not yours" must not be a 403.
 *
 * The writes then *also* constrain on `ownerId` in the query itself
 * (`where: { id, ownerId }`). That is redundant today, on purpose: it keeps the
 * ownership predicate visible at the point of the write, and it means a future
 * refactor that weakens the guard cannot turn these into cross-account writes.
 */

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  try {
    const inquiries = await prisma.propertyInquiry.findMany({
      where: { propertyId: guard.property.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return jsonOk({
      property: toSafeProperty(guard.property),
      inquiries: inquiries.map(toSafeInquiry),
    });
  } catch (error) {
    console.error("[properties] read failed:", error);
    return jsonServerError();
  }
}

/**
 * Replaces the editable fields.
 *
 * PATCH rather than PUT because it does not replace the whole *document* —
 * `status`, `ownerId` and the verification stamps are untouched by design and
 * are not part of the schema. But every editable field must be present: this is
 * not a sparse patch, and the form always submits the complete set. Sending
 * half the fields is a validation error, not a partial update — which is what
 * makes "clear the locality" expressible at all (`""` → `null`).
 *
 * Editing never changes status. A published listing stays published; a verified
 * one keeps its badge. Re-review on edit would be a defensible product rule, but
 * it is not implemented, so it is not implied.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const data = propertyWriteSchema.parse(body);

    const updated = await prisma.property.update({
      where: { id: guard.property.id, ownerId: guard.property.ownerId },
      data,
    });

    return jsonOk({ property: toSafeProperty(updated) });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[properties] update failed:", error);
    return jsonServerError();
  }
}

/**
 * Deletes the listing and, by the cascade declared on
 * `PropertyInquiry.property`, its inquiries.
 *
 * A hard delete, not a soft one. The alternative — a `deletedAt` column — would
 * mean every read path in the app (and every future public query) has to
 * remember to exclude it, and forgetting once resurrects a listing the owner
 * believes is gone. Nothing else in this schema is soft-deleted, so adding it
 * here for one model would be an inconsistency the next reader has to discover.
 */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = await requireOwnedProperty(id);
  if (!guard.ok) return guard.response;

  try {
    // deleteMany, not delete: it constrains on ownerId as well as id, and
    // reports how many rows matched instead of throwing on a row that a
    // concurrent request removed a moment ago.
    const result = await prisma.property.deleteMany({
      where: { id: guard.property.id, ownerId: guard.property.ownerId },
    });

    if (result.count === 0) {
      return jsonError("That property could not be found.", 404);
    }

    return jsonOk({ deleted: true, id: guard.property.id });
  } catch (error) {
    console.error("[properties] delete failed:", error);
    return jsonServerError();
  }
}
