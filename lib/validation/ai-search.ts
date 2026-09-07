import { z } from "zod";

import { MAX_AI_QUERY_LENGTH } from "@/lib/ai/prompts";
import { aiCriteriaSchema, normaliseAiCriteria } from "@/lib/ai/criteria";

/**
 * The request body for `POST /api/ai/property-search`.
 *
 * ── What the body may carry, and what it structurally cannot ────────────────
 *
 * Three fields: the sentence, the previous criteria, and the filters currently
 * on the page. `z.object` strips unknown keys, so a client posting `viewerId`,
 * `ownerId`, `status` or anything else has them removed before the route sees
 * them — the same subtraction every other schema in `lib/validation/` performs,
 * and for the same reason: those are not questions this endpoint answers.
 *
 * The identity used for saved-state resolution comes from the session cookie,
 * never from here. There is no field for it, so there is nothing to spoof.
 *
 * ── Why `previous` is revalidated rather than trusted ──────────────────────
 *
 * Follow-up refinement works by the client sending back the criteria object from
 * the previous turn — no server-side conversation store, so nothing about a
 * visitor's search history is retained anywhere. The cost of that is that the
 * value arrives from the client and could have been edited. Running it through
 * the same `aiCriteriaSchema` a model's answer goes through closes it: a
 * hand-edited `previous` is subject to exactly the closed vocabulary a
 * model-authored one is, so this channel cannot express a filter the visitor
 * could not have asked for directly.
 *
 * ── Why the filters arrive as a query string ───────────────────────────────
 *
 * `filters` is the page's own search string ("?max=7000000&beds=2"), parsed
 * server-side with the same `parseBrowseQuery` the page used. Sending the parsed
 * object instead would mean the client and the server each hold a copy of the
 * filter vocabulary, and the browse feature's whole design is that there is one
 * source of truth and it is the URL — see the header of
 * `lib/properties/browse-query.ts`. Parsing is total and never throws, so a
 * mangled string is a search with fewer filters, not a 400.
 */

/**
 * A visitor's sentence.
 *
 * Capped at `MAX_AI_QUERY_LENGTH`, which is both a bound on what is sent to a
 * third party and a bound on what anyone can make this endpoint spend. Control
 * characters are stripped for the same reason `lib/validation/inquiry.ts` strips
 * them: an invisible payload in text that is echoed back into the page.
 */
const searchText = z
  .string({ required_error: "Type what you are looking for." })
  .max(MAX_AI_QUERY_LENGTH * 8, "That message is too long.")
  .transform((value) =>
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_AI_QUERY_LENGTH)
  )
  .pipe(
    z
      .string()
      .min(3, "Tell me a little more about what you are looking for.")
      .max(MAX_AI_QUERY_LENGTH)
  );

export const aiSearchRequestSchema = z.object({
  query: searchText,

  /**
   * The criteria from the previous turn, or absent for a fresh search.
   *
   * Normalised through the same function a model's reply goes through, so the
   * value that reaches the search is `AiCriteria` — amenity slugs filtered
   * against the allowlist, inverted ranges dropped — rather than whatever shape
   * the client happened to post back.
   */
  previous: z.preprocess(
    (value) => (value === null ? undefined : value),
    aiCriteriaSchema.transform((value) => normaliseAiCriteria(value).criteria).optional()
  ),

  /**
   * The browse page's current query string, with or without the leading `?`.
   * Bounded so a caller cannot post a megabyte of parameters for the parser to
   * walk.
   */
  filters: z.string().max(2048).optional().default(""),

  /**
   * Which page the results are pinned to — `/explore`, `/buy` or `/rent`.
   *
   * An allowlist rather than a free string, because it decides `lockedIntent`
   * and is echoed back into a link. Anything else is `/explore`, the page where
   * both intents are visible.
   */
  basePath: z.enum(["/explore", "/buy", "/rent"]).optional().default("/explore"),
});

export type AiSearchRequest = z.infer<typeof aiSearchRequestSchema>;
