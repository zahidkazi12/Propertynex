import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireSession } from "@/lib/properties/access";
import { addFavorite, favoriteCount, removeFavorite } from "@/lib/properties/favorites";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import { favoriteSchema } from "@/lib/validation/favorite";

/**
 * `/api/favorites` — save and un-save a listing.
 *
 * ── Who a favorite belongs to ───────────────────────────────────────────────
 *
 * The session, always. `userId` is read from `requireSession()` and never from
 * the request, in the same way `ownerId` is never read from a request in
 * `/api/properties`. The body carries one field — which listing — and the schema
 * has nowhere to put a second.
 *
 * ── Why POST checks the listing and DELETE does not ────────────────────────
 *
 * Saving something requires it to be publicly live at that moment, which
 * `addFavorite` enforces in the same statement as the write. Two reasons, and the
 * second is the important one: a draft is not a thing a stranger can see, so
 * saving it is meaningless — and without the check, the 200/404 split on this
 * endpoint is an oracle that tells any signed-in user which ObjectIds are real
 * listings and which are drafts. It is the only write path a non-owner can aim at
 * a property row, so it is the only one that needs the guard.
 *
 * Un-saving needs no such check. A visitor must always be able to remove a save,
 * including for a listing that has since gone offline — that is exactly when they
 * would most want to. A delete that matches nothing is a 200, not a 404: the
 * button is optimistic and will be double-tapped, and "it is already gone" is the
 * outcome the caller asked for.
 *
 * ── Why the failure message is vague ───────────────────────────────────────
 *
 * "That property could not be found." covers a malformed id, a deleted row and a
 * draft belonging to someone else. Distinguishing them in the response would
 * hand back exactly the information the live-status check is there to withhold.
 * Same message, same status, as `lib/properties/access.ts` uses.
 */

/**
 * Generous, because a heart is a cheap interaction and a visitor scanning a
 * results page may well save eight listings in a minute. It is a ceiling on
 * scripted abuse — walking the ObjectId space to map the collection — not on
 * enthusiasm.
 */
const FAVORITE_LIMIT = 120;
const FAVORITE_WINDOW_MS = 10 * 60 * 1000;

const NOT_FOUND_MESSAGE = "That property could not be found.";

/** Shared by both handlers: session, rate limit, body. */
async function readRequest(request: NextRequest, bucket: string) {
  const session = await requireSession();
  if (!session.ok) return { ok: false as const, response: session.response };

  const limit = await checkRateLimit(bucket, session.user.id, FAVORITE_LIMIT, FAVORITE_WINDOW_MS);
  if (!limit.allowed) {
    return {
      ok: false as const,
      response: jsonError(
        `That's a lot of saving in a short time. Try again in ${Math.ceil(
          limit.retryAfterMs / 60000
        )} minute(s).`,
        429
      ),
    };
  }

  const body = await request.json();
  const { propertyId } = favoriteSchema.parse(body);
  return { ok: true as const, userId: session.user.id, propertyId };
}

/** Both handlers fail the same way, so they translate errors the same way. */
function handleError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return jsonError(NOT_FOUND_MESSAGE, 400, zodFieldErrors(error));
  }
  if (error instanceof SyntaxError) {
    return jsonError("Invalid request body.", 400);
  }
  console.error(`[favorites] ${action} failed:`, error);
  return jsonServerError();
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await readRequest(request, "favorite-add");
    if (!parsed.ok) return parsed.response;

    const saved = await addFavorite(parsed.userId, parsed.propertyId);
    if (!saved) return jsonError(NOT_FOUND_MESSAGE, 404);

    // The count comes back so a header counter can update without a second
    // round trip. `saved: true` is stated rather than implied because the client
    // is optimistic and needs a value to reconcile against, not just a status.
    return jsonOk({ saved: true, count: await favoriteCount(parsed.userId) });
  } catch (error) {
    return handleError(error, "add");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const parsed = await readRequest(request, "favorite-remove");
    if (!parsed.ok) return parsed.response;

    await removeFavorite(parsed.userId, parsed.propertyId);
    return jsonOk({ saved: false, count: await favoriteCount(parsed.userId) });
  } catch (error) {
    return handleError(error, "remove");
  }
}
