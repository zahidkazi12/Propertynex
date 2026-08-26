import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { isValidObjectId } from "@/lib/properties/ownership";
import { LIVE_STATUSES } from "@/lib/properties/status";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import { inquirySchema } from "@/lib/validation/inquiry";

/**
 * `POST /api/inquiries` — a visitor contacting a seller about one listing.
 *
 * ── Why there is no session requirement ─────────────────────────────────────
 *
 * A buyer who has found the right flat should be able to say so without first
 * creating an account, and `PropertyInquiry.fromUserId` is nullable precisely to
 * record that. So this is the one write endpoint in the app open to an anonymous
 * caller — which is what makes everything below matter more than it would
 * elsewhere.
 *
 * ── The three fields the request cannot set ─────────────────────────────────
 *
 * `ownerId` is copied off the property row this route loads. `fromUserId` comes
 * from the session cookie or is null. `status` is left at its `NEW` default. The
 * schema in `lib/validation/inquiry.ts` has no field for any of them, and the
 * `create` below names each column rather than spreading the parsed body, so
 * adding a column to `PropertyInquiry` cannot quietly make it client-writable.
 *
 * ── Only live listings receive inquiries ───────────────────────────────────
 *
 * Same rule and same reason as saving: the property is loaded with
 * `status: { in: LIVE_STATUSES }`, so a DRAFT id yields the same 404 a nonexistent
 * one does. Without it, an anonymous caller could enumerate ObjectIds and read
 * the 201/404 split to discover which drafts exist — and, worse, could deliver
 * mail into the inbox of a listing its owner has not published.
 *
 * ── Rate limiting an endpoint with no login ────────────────────────────────
 *
 * Keyed on the account when there is one and on the client IP when there is not.
 * The IP bucket is the weaker of the two — a bare `x-forwarded-for` read behind a
 * proxy that does not set it honestly is spoofable — so it is deliberately the
 * tighter limit, and the per-property bucket below sits underneath both. This is
 * spam control, not authentication.
 */

/** Per caller, across all listings. */
const SIGNED_IN_LIMIT = 20;
const ANONYMOUS_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Per caller, per listing. Five identical enquiries about one flat is not a buyer
 * being keen; it is a form being resubmitted or a script running. Separate from
 * the limit above so that legitimately writing to eight different sellers in an
 * evening does not look like abuse.
 */
const PER_PROPERTY_LIMIT = 3;
const PER_PROPERTY_WINDOW_MS = 24 * 60 * 60 * 1000;

const NOT_FOUND_MESSAGE = "That property could not be found.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = inquirySchema.parse(body);

    // Shape-checked by the schema too; repeated here because the id reaches
    // Prisma below and the Mongo connector throws on a malformed ObjectId.
    if (!isValidObjectId(input.propertyId)) {
      return jsonError(NOT_FOUND_MESSAGE, 404);
    }

    const user = await getCurrentUser();
    const callerKey = user ? `user:${user.id}` : `ip:${getClientIp(request)}`;

    const overall = await checkRateLimit(
      "inquiry-send",
      callerKey,
      user ? SIGNED_IN_LIMIT : ANONYMOUS_LIMIT,
      WINDOW_MS
    );
    if (!overall.allowed) {
      return jsonError(
        `You've sent a lot of enquiries recently. Try again in ${Math.ceil(
          overall.retryAfterMs / 60000
        )} minute(s).`,
        429
      );
    }

    const perProperty = await checkRateLimit(
      "inquiry-property",
      `${callerKey}:${input.propertyId}`,
      PER_PROPERTY_LIMIT,
      PER_PROPERTY_WINDOW_MS
    );
    if (!perProperty.allowed) {
      return jsonError("You've already contacted this seller. They'll be in touch.", 429);
    }

    // `ownerId` is selected, not accepted. This is the row that decides both
    // whether the listing may receive mail and who receives it.
    const property = await prisma.property.findFirst({
      where: { id: input.propertyId, status: { in: [...LIVE_STATUSES] } },
      select: { id: true, ownerId: true },
    });
    if (!property) return jsonError(NOT_FOUND_MESSAGE, 404);

    await prisma.propertyInquiry.create({
      data: {
        propertyId: property.id,
        // From the property row.
        ownerId: property.ownerId,
        // From the session cookie, or null for a signed-out visitor.
        fromUserId: user?.id ?? null,

        name: input.name,
        email: input.email,
        phone: input.phone,
        message: input.message,
        // `status` is left at its NEW default: it is the owner's workflow field.
      },
    });

    // No id is returned. The sender has no endpoint that takes one — reading and
    // advancing an inquiry are the owner's operations — so handing one back would
    // publish an identifier with no use except as something to guess with.
    return jsonOk({ sent: true }, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[inquiries] create failed:", error);
    return jsonServerError();
  }
}
