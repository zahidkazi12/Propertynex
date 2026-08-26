import "server-only";

import { BROWSE_SORTS, type BrowseQuery, type BrowseSort } from "./browse-query";

/**
 * Whether an AI match score can be computed, and the seam where one would plug
 * in.
 *
 * ── Why this file exists rather than an `orderBy` clause ────────────────────
 *
 * The browse spec asks for an "AI Match Score" sort *when AI functionality is
 * available*. In this deployment it is not: nothing in package.json talks to a
 * model, and there is no column holding a precomputed score. So the option is
 * withheld — and withheld from one place, checked once per request, rather than
 * by five components each deciding whether to render it.
 *
 * Offering it anyway was the alternative, and it fails whichever way it is
 * built. Aliased to relevance, the dropdown says "AI match score" and sorts by
 * something else, which is a lie told in the UI. Left to sort by nothing, it
 * silently returns the default order and looks broken. Neither is better than an
 * option that is honestly absent until the capability is real.
 *
 * ── Why a scorer is not a sort clause ──────────────────────────────────────
 *
 * A real match score depends on the *whole* query — budget fit, locality
 * preference, amenity overlap, how close a 2BHK comes to a 3BHK request — so it
 * cannot be expressed as `orderBy` on a column. It has to run over candidate
 * rows after they are selected, which is what `rank()` below describes: the
 * filtered ids go in, a reordering comes out. Pinning that signature now is the
 * point of the type; it is what stops "add AI sorting" from turning into a
 * restructure of `browsePublicListings`.
 *
 * ── Why a mutable slot and not an env flag ─────────────────────────────────
 *
 * The same swap seam `lib/auth/rate-limit.ts` and `lib/otp/providers/` already
 * use. An env flag can be set without an implementation existing behind it,
 * which reintroduces exactly the dishonest option this module is here to
 * prevent. A slot can only be non-null if something filled it.
 *
 * `server-only`: the availability answer must be computed on the server and
 * handed to the client as a prop. A client component reading it would inline
 * `undefined` at build time and disagree with the server on first render.
 */

export type MatchScorer = {
  /** For logs. */
  readonly name: string;
  /**
   * Reorder candidate property ids best-first for this query.
   *
   * Receives ids rather than rows so an implementation cannot widen what leaves
   * the database, and returns ids rather than rows so it cannot invent one.
   */
  rank(input: {
    readonly query: BrowseQuery;
    readonly candidateIds: readonly string[];
  }): Promise<readonly string[]>;
};

let scorer: MatchScorer | null = null;

/** Install a scorer (or `null` to remove one). Nothing calls this yet. */
export function installMatchScorer(next: MatchScorer | null): void {
  scorer = next;
}

export function getMatchScorer(): MatchScorer | null {
  return scorer;
}

export function isAiMatchAvailable(): boolean {
  return scorer !== null;
}

/**
 * The sorts a visitor may actually choose right now.
 *
 * Passed to `parseBrowseQuery` as `allowedSorts` *and* to the filter form as the
 * option list, from the same call — so a hand-typed `?sort=ai-match` and the
 * dropdown can never disagree about whether that sort exists.
 */
export function availableSorts(): readonly BrowseSort[] {
  if (isAiMatchAvailable()) return BROWSE_SORTS;
  return BROWSE_SORTS.filter((sort) => sort !== "ai-match");
}
