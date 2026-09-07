import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { getClientIp, checkRateLimit } from "@/lib/auth/rate-limit";
import { getCurrentUser } from "@/lib/auth/session";
import { aiFailureCode, AiError } from "@/lib/ai/errors";
import { isAiSearchAvailable } from "@/lib/ai/provider";
import { runAiSearch } from "@/lib/ai/property-search";
import { aiCriteriaChips } from "@/lib/ai/merge";
import { browseQueryString, parseBrowseQuery } from "@/lib/properties/browse-query";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";
import { aiSearchRequestSchema } from "@/lib/validation/ai-search";

/**
 * `POST /api/ai/property-search` — one natural-language search.
 *
 * ── Why POST, and why it is not cached ──────────────────────────────────────
 *
 * The body carries the previous turn's criteria and the page's filters, which is
 * more than belongs in a URL, and each call spends money at a third party. Route
 * Handlers are uncached by default and nothing here opts in.
 *
 * ── What the response contains ─────────────────────────────────────────────
 *
 * The criteria, the listings, and one match breakdown per listing. The listings
 * are `PublicListing` objects straight from `browsePublicListings` — the same
 * projection `/explore` renders, which is the one that has no `ownerId`, no
 * street address, no pincode, no raw coordinates and no contact details. There
 * is no separate serialiser here and deliberately so: a second projection is a
 * second chance to publish a field the first one withholds.
 *
 * Nothing about the AI is exposed beyond the provider's short name. No key, no
 * endpoint, no model parameters, no prompt, and no provider error text — a
 * failure is a code from a closed union and a sentence written here.
 *
 * ── Why a signed-out visitor may call it ───────────────────────────────────
 *
 * Because browsing is public, and an assistant that required an account to
 * search would be a worse version of the filter bar. The session is read for
 * exactly what `browsePublicListings` reads it for — which hearts render filled
 * — and cannot widen the result set. It is also the rate-limit key when present,
 * which is a better key than an IP.
 */

/**
 * Rate limit.
 *
 * Tighter than the favorites endpoint by a wide margin, because every call is a
 * paid request to a third party rather than a row in a table. Twenty searches in
 * ten minutes is far more than a person refining a search will use and far less
 * than a script can spend. Keyed to the account when there is one and to the IP
 * otherwise, so one signed-out network cannot exhaust everybody's budget and a
 * signed-in user carries their own.
 */
const AI_SEARCH_LIMIT = 20;
const AI_SEARCH_WINDOW_MS = 10 * 60 * 1000;

/**
 * What a visitor is told, per failure.
 *
 * Every one of them ends by pointing at the filters, because that is the true
 * and useful thing: the marketplace works without the assistant. No message
 * names a provider, a variable, or a status code.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  ai_not_configured:
    "AI search is not available on this site. You can still use the filters to search every listing.",
  ai_unavailable:
    "AI search is temporarily unavailable. You can continue using the filters, or try again in a moment.",
  ai_timeout:
    "AI search took too long to respond. You can continue using the filters, or try again.",
  ai_invalid_response:
    "I could not turn that into a search. Try rephrasing it — for example, “2BHK under 80 lakh in Vikhroli with parking”.",
};

export async function POST(request: NextRequest) {
  // Availability first, before the body is read or a limit is spent: a
  // deployment with no provider should answer this cheaply and identically every
  // time, and the panel is not rendered there in the first place.
  if (!isAiSearchAvailable()) {
    return jsonError(FAILURE_MESSAGES.ai_not_configured, 503, undefined, {
      code: "ai_not_configured",
    });
  }

  const user = await getCurrentUser();
  const limitKey = user?.id ?? getClientIp(request);

  const limit = await checkRateLimit(
    "ai-search",
    limitKey,
    AI_SEARCH_LIMIT,
    AI_SEARCH_WINDOW_MS
  );
  if (!limit.allowed) {
    return jsonError(
      `That's a lot of AI searches in a short time. Try again in ${Math.ceil(
        limit.retryAfterMs / 60000
      )} minute(s) — the filters keep working in the meantime.`,
      429,
      undefined,
      { code: "rate_limited" }
    );
  }

  try {
    const body = await request.json();
    const input = aiSearchRequestSchema.parse(body);

    // The filters the page is showing, parsed with the same total parser the
    // page itself used — so "what the visitor set" means exactly the same thing
    // on both sides. `lockedIntent` reproduces what /buy and /rent pass.
    const manual = parseBrowseQuery(
      Object.fromEntries(new URLSearchParams(input.filters.replace(/^\?/, ""))),
      {
        lockedIntent:
          input.basePath === "/buy" ? "BUY" : input.basePath === "/rent" ? "RENT" : null,
      }
    );

    const outcome = await runAiSearch({
      query: input.query,
      previous: input.previous ?? null,
      manual,
      viewerId: user?.id ?? null,
    });

    return jsonOk({
      criteria: outcome.criteria,
      // What the assistant understood, as labelled chips — built server-side so
      // the panel cannot render a different reading of the criteria than the one
      // the query was built from.
      chips: aiCriteriaChips(outcome.criteria),
      conflicts: outcome.conflicts,
      unsupported: outcome.unsupported,

      // Real rows, in the public projection, best-first.
      available: outcome.result.available,
      total: outcome.result.total,
      properties: outcome.scored.map((entry) => entry.listing),
      matchScores: outcome.scored.map((entry) => entry.match),
      savedIds: [...outcome.result.savedIds],

      // The same search as a shareable link — the escape hatch out of the
      // assistant and into the ordinary filtered page, which is also the proof
      // that the AI applied nothing the filter bar cannot express.
      href: `${input.basePath}${browseQueryString(outcome.query)}`,
      provider: outcome.providerName,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please check your search and try again.", 400, zodFieldErrors(error), {
        code: "invalid_request",
      });
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400, undefined, { code: "invalid_request" });
    }

    const code = aiFailureCode(error);
    if (code) {
      // The provider's own message goes to the server log only — it can name a
      // variable, a status code or a model, and none of that belongs in a
      // response body. See lib/ai/errors.ts.
      console.error("[ai-search] provider failure:", error);
      return jsonError(FAILURE_MESSAGES[code], code === "ai_invalid_response" ? 422 : 503, undefined, {
        code,
      });
    }
    if (error instanceof AiError) {
      console.error("[ai-search] unclassified AI failure:", error);
      return jsonError(FAILURE_MESSAGES.ai_unavailable, 503, undefined, { code: "ai_unavailable" });
    }

    console.error("[ai-search] failed:", error);
    return jsonServerError();
  }
}
