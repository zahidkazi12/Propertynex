import "server-only";

import { AiInvalidResponseError } from "@/lib/ai/errors";
import { getAiProvider } from "@/lib/ai/provider";
import {
  aiCriteriaSchema,
  normaliseAiCriteria,
  type AiCriteria,
  type AiCriteriaInput,
} from "@/lib/ai/criteria";
import { mergeAiCriteria, type AiConflict, type AiUnsupported } from "@/lib/ai/merge";
import { scoreListings, type ScoredListing } from "@/lib/ai/match";
import {
  AI_TIMEOUT_MS,
  MAX_AI_OUTPUT_TOKENS,
  buildPreviousCriteriaMessage,
  buildSystemPrompt,
  buildUserPrompt,
  criteriaJsonSchema,
} from "@/lib/ai/prompts";
import type { AiMessage } from "@/lib/ai/types";
import { browsePublicListings, type BrowseResult } from "@/lib/properties/public";
import { amenityLabel } from "@/lib/properties/constants";
import type { BrowseQuery } from "@/lib/properties/browse-query";

/**
 * The AI search pipeline, end to end.
 *
 *   sentence
 *     → provider (understands it)          ← the only model call
 *     → Zod (validates the criteria)       ← model output stops being text here
 *     → merge with the visitor's filters   ← manual filters win
 *     → browsePublicListings               ← the existing public read path
 *     → deterministic scoring              ← arithmetic over real rows
 *     → cards
 *
 * ── The property this file exists to hold ───────────────────────────────────
 *
 * **A listing reaches the visitor only by coming back from the database.** The
 * model is consulted once, before any query runs, and what it returns is a
 * criteria object — never a listing, never a price, never an id. The array of
 * properties in the response is `BrowseResult.listings`, built by
 * `toPublicListing` from real rows, and nothing in this module can add to it or
 * edit an entry in it. The strongest way to state that is structural: the
 * provider is called on line one and is out of scope by the time
 * `browsePublicListings` is reached, so there is no point in the flow where
 * model output and listing data are both in hand and could be mixed.
 *
 * ── What the provider is sent ──────────────────────────────────────────────
 *
 * The visitor's own typed sentence, and — on a follow-up — the criteria object
 * this application derived from their previous one. That is all. Not the
 * session, not a name or an email or a phone number, not the listings, not the
 * result count, not the saved-property list, not the filters in the URL.
 *
 * The merge deliberately happens *after* the model call for exactly that reason.
 * Sending the visitor's current filters would let the model resolve conflicts
 * itself, which sounds better and would mean the provider learns what this
 * person is shopping for and at what budget. Doing it here costs nothing —
 * `mergeAiCriteria` is a pure function — and means a provider never receives a
 * profile.
 *
 * ── Why the database is queried through the existing path ──────────────────
 *
 * `browsePublicListings` already enforces `status: { in: LIVE_STATUSES }` as a
 * non-negotiable first clause, projects through `toPublicListing` (no owner id,
 * no street address, no coordinates beyond the precision gate, no contact
 * details), resolves saved state from the session, and paginates. Every one of
 * those properties is one the AI path needs and none of them is worth
 * reimplementing. So the AI path issues no query of its own: it hands a
 * `BrowseQuery` to the same function `/explore` uses, and inherits the lot.
 */

/** How much of one page is scored. `BROWSE_PER_PAGE` is 12; scoring is O(n) over
 *  plain objects, so the cost is trivial and the bound is the query's, not ours. */
export type AiSearchOutcome = {
  readonly criteria: AiCriteria;
  /** The query actually run — shareable, and the same shape a URL produces. */
  readonly query: BrowseQuery;
  readonly result: BrowseResult;
  /** Listings, best-first, each with its factor breakdown. Same length as
   *  `result.listings` — scoring reorders, it never filters. */
  readonly scored: readonly ScoredListing[];
  readonly conflicts: readonly AiConflict[];
  readonly unsupported: readonly AiUnsupported[];
  /** Which provider answered, for the panel's "understood by" line. Never a key. */
  readonly providerName: string;
};

export type AiSearchInput = {
  /** What the visitor typed. Already length-capped by the route's schema. */
  readonly query: string;
  /**
   * The criteria from the previous turn, if this is a refinement.
   *
   * Round-tripped through the client rather than stored server-side. It is
   * revalidated with `aiCriteriaSchema` at the route boundary before it arrives
   * here, so a hand-edited value is subject to exactly the same closed
   * vocabulary as a model-authored one — a client cannot smuggle a filter
   * through the "previous criteria" channel that it could not have asked for
   * directly.
   */
  readonly previous?: AiCriteria | null;
  /** The filters currently on the page. Not sent to the provider. */
  readonly manual: BrowseQuery;
  /** For saved-state resolution only; never reaches the provider. */
  readonly viewerId?: string | null;
};

/**
 * Turn one sentence into criteria.
 *
 * Split from the search so a test can exercise extraction against a stub
 * provider without a database, and so the route can report a provider failure
 * before any query is issued.
 */
export async function extractCriteria(input: {
  query: string;
  previous?: AiCriteria | null;
}): Promise<{ criteria: AiCriteria; droppedAmenities: readonly string[]; providerName: string }> {
  const provider = getAiProvider();
  if (!provider) {
    // Unreachable through the route, which checks availability first — but a
    // direct caller must not get a null-dereference where it means "no AI".
    throw new AiInvalidResponseError("none", "no AI provider is configured");
  }

  const messages: AiMessage[] = [];
  if (input.previous) {
    // The model's own previous answer, replayed as its own turn. See
    // `buildPreviousCriteriaMessage` for why this is the assistant role.
    messages.push({ role: "user", content: buildUserPrompt("(previous search)") });
    messages.push({ role: "assistant", content: buildPreviousCriteriaMessage(input.previous) });
  }
  messages.push({ role: "user", content: buildUserPrompt(input.query) });

  const raw = await provider.complete({
    system: buildSystemPrompt(),
    messages,
    jsonSchema: criteriaJsonSchema(),
    maxOutputTokens: MAX_AI_OUTPUT_TOKENS,
    timeoutMs: AI_TIMEOUT_MS,
  });

  const parsed = parseCriteriaJson(raw, provider.name);
  const validated = aiCriteriaSchema.safeParse(parsed);
  if (!validated.success) {
    // The boundary doing its job. The issue paths go to the log; the visitor is
    // told the request could not be read, not which key was malformed.
    throw new AiInvalidResponseError(
      provider.name,
      validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")
    );
  }

  const { criteria, droppedAmenities } = normaliseAiCriteria(validated.data as AiCriteriaInput);
  return { criteria, droppedAmenities, providerName: provider.name };
}

/**
 * Parse the provider's text as JSON.
 *
 * Tolerates a markdown fence, because models wrap JSON in one often enough that
 * refusing would turn a formatting habit into a user-visible failure — and
 * unwrapping is unambiguous. It does **not** tolerate anything else: no
 * regex-scraping of values out of prose, no partial recovery. If the text is not
 * an object, the answer is unusable and says so.
 */
function parseCriteriaJson(raw: string, providerName: string): unknown {
  let text = raw.trim();

  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiInvalidResponseError(providerName, "response was not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AiInvalidResponseError(providerName, "response was not a JSON object");
  }

  return parsed;
}

/**
 * The whole pipeline.
 *
 * Throws only for provider faults — everything after the model call degrades
 * rather than throwing. `browsePublicListings` never throws (it returns
 * `available: false`), so a database outage during an AI search produces the
 * same "listings are temporarily unavailable" panel the ordinary browse page
 * shows, with the criteria still displayed.
 */
export async function runAiSearch(input: AiSearchInput): Promise<AiSearchOutcome> {
  const { criteria, droppedAmenities, providerName } = await extractCriteria({
    query: input.query,
    previous: input.previous ?? null,
  });

  const merged = mergeAiCriteria(input.manual, criteria);

  const result = await browsePublicListings(merged.query, {
    viewerId: input.viewerId ?? null,
    extra: merged.extra,
  });

  // Scored against the criteria the visitor *expressed*, not against the merged
  // query. If a manual ₹70L cap overrode a requested ₹90L, the listings shown
  // are the ones under ₹70L — but the score still answers "how well does this
  // fit what I asked for", and the conflict note explains the difference. Scoring
  // against the merged query would make every listing a perfect match by
  // construction, which is a number with no information in it.
  const scored = scoreListings(result.listings, criteria);

  const unsupported = [...merged.unsupported];
  for (const slug of droppedAmenities) {
    unsupported.push({
      kind: "amenity",
      label: slug,
      message: `“${slug}” is not one of the amenities listings can be tagged with, so I could not filter by it.`,
    });
  }

  return {
    criteria,
    query: merged.query,
    result,
    scored,
    conflicts: merged.conflicts,
    unsupported,
    providerName,
  };
}

/** Re-exported so the route builds its response from one import. */
export { amenityLabel };
