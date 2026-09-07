"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Loader2,
  RotateCcw,
  SearchX,
  Sparkles,
  X,
} from "lucide-react";

import { AiMatchCard } from "@/components/marketplace/AiMatchCard";
import { cn } from "@/lib/utils/cn";
import type { AiConflict, AiCriteriaChip, AiUnsupported } from "@/lib/ai/merge";
import type { AiCriteria } from "@/lib/ai/criteria";
import type { MatchResult } from "@/lib/ai/match";
import { MAX_AI_QUERY_LENGTH } from "@/lib/ai/prompts";
import { groupIndian } from "@/lib/properties/format";
import type { PublicListing } from "@/types";

/**
 * The AI property assistant, on the existing browse pages.
 *
 * ── Why it is a panel above the filters, not a chat window ──────────────────
 *
 * This is a marketplace, and the listings are the content. A conversation
 * surface that occupied the page would make the assistant the product and the
 * properties an accessory to it. So it is one input in the existing card
 * treatment: closed it is a search box, and it only grows once it has something
 * real to show. The filter bar underneath is untouched and keeps working with
 * the panel open, closed, failing, or absent.
 *
 * ── Rendered only where it can work ────────────────────────────────────────
 *
 * Availability is decided on the server (`isAiSearchAvailable`) and passed down
 * as a prop; a deployment with no provider does not render this component at
 * all. That follows `ExploreMapPanel`'s handling of a missing maps key and
 * `lib/maps/nearby.ts`'s reasoning: an unconfigured capability is absent, not
 * broken. The "temporarily unavailable" copy below is for a provider that *is*
 * configured and failed — a different situation, and the one where telling the
 * visitor to use the filters is genuinely the next step.
 *
 * ── Conversation state lives here and nowhere else ─────────────────────────
 *
 * The transcript is `useState` in this component: the sentences typed this
 * session and the last criteria object. Nothing is written to a server, a
 * cookie or storage, and the criteria are sent back on the next turn so the
 * server can stay stateless. Reloading the page clears it, which is the correct
 * behaviour for a search — the URL is the durable state, and "Open as filtered
 * results" is how a search becomes durable.
 *
 * ── Every failure keeps the page usable ────────────────────────────────────
 *
 * Provider down, timeout, rate limit, unreadable reply, database unavailable, no
 * matches: each is a distinct message inside this panel. None of them replaces
 * the page, and the filter form below is never disabled.
 */

type AiSearchResponse = {
  criteria: AiCriteria;
  chips: AiCriteriaChip[];
  conflicts: AiConflict[];
  unsupported: AiUnsupported[];
  available: boolean;
  total: number;
  properties: PublicListing[];
  matchScores: MatchResult[];
  savedIds: string[];
  href: string;
  provider: string;
};

type PanelError = {
  readonly code: string;
  readonly message: string;
  /** False for the failures where trying the same sentence again cannot help. */
  readonly retryable: boolean;
};

const EXAMPLES = [
  "2BHK under 80 lakh in Vikhroli with parking",
  "Furnished flat to rent in Powai under 60k",
  "Plot in Bengaluru between 1000 and 2000 sq ft",
];

/** Suggested refinements, from the brief's own follow-up examples. */
const REFINEMENTS = ["Show me cheaper options", "Only ones with parking", "Make it 3 bedrooms"];

export function AiSearchPanel({
  basePath,
  filters,
  signedIn,
  redirectTo,
}: {
  /** `/explore`, `/buy` or `/rent` — decides the locked intent server-side. */
  basePath: string;
  /** The page's current query string, forwarded so manual filters win. */
  filters: string;
  signedIn: boolean;
  redirectTo: string;
}) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);
  const [response, setResponse] = useState<AiSearchResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasConversation = turns.length > 0;

  async function ask(text: string) {
    const query = text.trim();
    if (query.length < 3 || pending) return;

    setPending(true);
    setError(null);

    try {
      const httpResponse = await fetch("/api/ai/property-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          // The previous turn's criteria, so "cheaper" has something to be
          // cheaper *than*. Never anything about the person.
          previous: response?.criteria ?? null,
          filters,
          basePath,
        }),
      });

      const payload: unknown = await httpResponse.json().catch(() => null);

      if (!httpResponse.ok) {
        const record = (payload ?? {}) as { error?: unknown; code?: unknown };
        const code = typeof record.code === "string" ? record.code : "ai_unavailable";
        setError({
          code,
          message:
            typeof record.error === "string"
              ? record.error
              : "AI search is temporarily unavailable. You can continue using the filters.",
          // A malformed reply or a bad request will repeat identically; an
          // outage, a timeout or a spent budget will not.
          retryable: code !== "ai_invalid_response" && code !== "invalid_request",
        });
        return;
      }

      setResponse(payload as AiSearchResponse);
      setTurns((previous) => [...previous, query]);
      setDraft("");
    } catch {
      setError({
        code: "offline",
        message: "You appear to be offline. The filters still work on this page.",
        retryable: true,
      });
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function clear() {
    setDraft("");
    setTurns([]);
    setResponse(null);
    setError(null);
    inputRef.current?.focus();
  }

  const savedIds = new Set(response?.savedIds ?? []);

  return (
    <section
      className="glass-card edge-glow relative mb-5 overflow-hidden p-5 sm:p-6"
      aria-label="AI property assistant"
    >
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-48"
        style={{
          background: "radial-gradient(50% 100% at 20% 100%, rgba(124,58,237,0.16) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
            <Sparkles className="h-4 w-4 text-cyan" aria-hidden="true" />
            AI property assistant
          </h2>
          {(hasConversation || error) && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {/* The transcript. Compact by design — the sentences, not a chat log. */}
        {hasConversation && (
          <ol className="mt-3 space-y-1">
            {turns.map((turn, index) => (
              <li
                key={`${index}-${turn}`}
                className="flex items-start gap-2 text-xs text-slate-400"
              >
                <span className="mt-px shrink-0 text-slate-600">You</span>
                <span className="min-w-0 text-slate-300">“{turn}”</span>
              </li>
            ))}
          </ol>
        )}

        <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_AI_QUERY_LENGTH}
            placeholder={
              hasConversation
                ? "Refine it — “show me cheaper options”"
                : "Describe what you're looking for, in your own words"
            }
            aria-label={
              hasConversation ? "Refine your AI property search" : "Describe the property you want"
            }
            className="input-field flex-1"
            disabled={pending}
          />
          <button
            type="submit"
            className="btn-primary shrink-0 px-6"
            disabled={pending || draft.trim().length < 3}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {pending ? "Thinking…" : hasConversation ? "Refine" : "Find properties"}
          </button>
        </form>

        {/* Prompts. Examples before the first search, refinements after — so the
            visitor is never staring at an empty box wondering what it accepts. */}
        {!pending && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(hasConversation ? REFINEMENTS : EXAMPLES).map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void ask(example)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400 transition-colors hover:border-cyan/30 hover:text-white"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {/* ── Failure. Never replaces the page, always points at the filters. */}
        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="leading-relaxed">{error.message}</p>
              {error.retryable && turns.length + (draft ? 1 : 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void ask(draft || turns[turns.length - 1])}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200 underline underline-offset-2 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Understood. */}
        {response && (
          <div className="mt-5 border-t border-white/[0.08] pt-5">
            {response.chips.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Understood from your request
                </p>
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {response.chips.map((chip) => (
                    <li
                      key={chip.id}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        chip.applied
                          ? "border-cyan/30 bg-cyan/[0.08] text-cyan"
                          : "border-white/10 bg-white/[0.03] text-slate-500 line-through decoration-slate-600"
                      )}
                      title={chip.applied ? undefined : "Understood, but this site has no data to filter by it"}
                    >
                      {chip.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                I could not find any property requirements in that. Try naming a budget, a
                locality, or how many bedrooms you need.
              </p>
            )}

            {/* Manual filters won. Stated, never silent — see lib/ai/merge.ts. */}
            {response.conflicts.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {response.conflicts.map((conflict) => (
                  <li
                    key={conflict.field}
                    className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-slate-300"
                  >
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan/70" aria-hidden="true" />
                    <span>{conflict.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Understood, and not answerable with the data this app stores. */}
            {response.unsupported.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {response.unsupported.map((note) => (
                  <li
                    key={`${note.kind}:${note.label}`}
                    className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500"
                  >
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{note.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* ── Results. */}
            {!response.available ? (
              <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                I understood your request, but listings could not be loaded just now. This is on
                our side — please try again in a moment.
              </p>
            ) : response.properties.length === 0 ? (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <div className="min-w-0 text-sm text-slate-300">
                  <p className="leading-relaxed">
                    No properties in the current database match all of these requirements.
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Nothing is being held back — every listing on PROPERTYNEX was checked. Try
                    widening the budget, dropping a requirement, or naming a nearby locality.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                  <p className="text-sm font-semibold text-white">
                    <span className="tabular">{groupIndian(response.total)}</span>{" "}
                    {response.total === 1 ? "property" : "properties"} matched
                    {response.total > response.properties.length && (
                      <span className="font-normal text-slate-400">
                        {" "}
                        — showing the first {response.properties.length}
                      </span>
                    )}
                  </p>
                  {/* The escape hatch: the same search as an ordinary filtered
                      page, with pagination, sorting and the map. Also the proof
                      that the assistant applied nothing the filters cannot. */}
                  <Link
                    href={response.href}
                    className="group inline-flex items-center gap-1.5 text-xs font-semibold text-cyan transition-colors hover:text-white"
                  >
                    Open as filtered results
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform duration-300 ease-premium group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </div>

                <div className="mt-4 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                  {response.properties.map((listing, index) => (
                    <AiMatchCard
                      key={listing.id}
                      listing={listing}
                      match={response.matchScores[index]}
                      saved={savedIds.has(listing.id)}
                      signedIn={signedIn}
                      redirectTo={redirectTo}
                    />
                  ))}
                </div>

                <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
                  Every property above is a live listing from the PROPERTYNEX database. Match
                  scores are calculated by this site from the listing&rsquo;s own data — not
                  written by the AI, which only reads your request.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
