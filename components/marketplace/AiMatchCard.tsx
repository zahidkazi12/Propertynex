"use client";

import { Check, Minus, Sparkles, X, type LucideIcon } from "lucide-react";

import { ListingCard } from "@/components/marketplace/ListingCard";
import { cn } from "@/lib/utils/cn";
import type { MatchFactor, MatchResult, MatchStatus } from "@/lib/ai/match";
import type { PublicListing } from "@/types";

/**
 * One recommended listing: the score, the breakdown, and the ordinary card.
 *
 * ── Why this wraps `ListingCard` instead of replacing it ────────────────────
 *
 * A property looks the same whether a person found it through the filter bar or
 * by asking for it in a sentence — same photos, same price line, same
 * verification badge, same working heart. So the card is imported unchanged and
 * the AI-specific part sits above it. Two consequences worth stating: nothing in
 * the assistant can render a listing field the ordinary grid does not (it
 * receives the same `PublicListing`), and a change to the card reaches both
 * surfaces at once instead of one of them drifting.
 *
 * ── Why the breakdown is always visible ────────────────────────────────────
 *
 * A bare "94%" is a number a visitor has to take on faith. The rows underneath
 * are where it comes from, and every one of them names the listing's own value —
 * "Covered parking according to the listing", "₹78 L, within your budget". The
 * score is the summary of the rows, not a claim standing on its own.
 *
 * ── The fourth state ───────────────────────────────────────────────────────
 *
 * `—` means the listing does not carry that information, and it is visually
 * distinct from `✕`. It has to be: a seller who left the parking field blank has
 * not said there is no parking, and a UI that renders both as a cross tells the
 * visitor something the database does not know. Rows in that state are excluded
 * from the percentage — see `lib/ai/match.ts`.
 */

const STATUS_ICONS: Record<MatchStatus, LucideIcon> = {
  match: Check,
  partial: Check,
  miss: X,
  unknown: Minus,
};

const STATUS_TONES: Record<MatchStatus, string> = {
  match: "text-emerald-300",
  partial: "text-amber-300",
  miss: "text-rose-300",
  unknown: "text-slate-500",
};

/** Read out by screen readers, where a coloured tick means nothing. */
const STATUS_LABELS: Record<MatchStatus, string> = {
  match: "Matches",
  partial: "Partly matches",
  miss: "Does not match",
  unknown: "Not stated in this listing",
};

/** Score → the colour of the badge. The thresholds match `summarise()` in
 *  lib/ai/match.ts, so the badge and the sentence never disagree. */
function badgeTone(score: number): string {
  if (score >= 85) return "border-emerald-400/40 bg-emerald-500/12 text-emerald-200";
  if (score >= 65) return "border-cyan/40 bg-cyan/10 text-cyan";
  if (score >= 40) return "border-amber-400/35 bg-amber-500/10 text-amber-200";
  return "border-white/15 bg-white/[0.04] text-slate-300";
}

function FactorRow({ factor }: { factor: MatchFactor }) {
  const Icon = STATUS_ICONS[factor.status];

  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed">
      <Icon
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", STATUS_TONES[factor.status])}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="font-semibold text-slate-200">{factor.label}</span>
        <span className="sr-only"> — {STATUS_LABELS[factor.status]}</span>
        <span className="text-slate-400"> · {factor.detail}</span>
      </span>
    </li>
  );
}

export function AiMatchCard({
  listing,
  match,
  saved,
  signedIn,
  redirectTo,
}: {
  listing: PublicListing;
  match: MatchResult;
  saved: boolean;
  signedIn: boolean;
  redirectTo: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {match.score === null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Not enough data to score
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tabular",
                badgeTone(match.score)
              )}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {match.score}% match
            </span>
          )}
          <p className="min-w-0 text-xs text-slate-400">{match.summary}</p>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-300">{match.explanation}</p>

        <ul className="mt-3 grid gap-1.5 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
          {match.factors.map((factor) => (
            <FactorRow key={factor.id} factor={factor} />
          ))}
        </ul>

        {match.caveats.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Not stated by this listing:{" "}
            {match.caveats.map((caveat) => caveat.replace(/\.$/, "")).join("; ")}. These are left
            out of the score rather than counted either way.
          </p>
        )}
      </div>

      <ListingCard
        listing={listing}
        saved={saved}
        signedIn={signedIn}
        redirectTo={redirectTo}
      />
    </div>
  );
}
