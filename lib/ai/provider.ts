import "server-only";

import { AiNotConfiguredError } from "@/lib/ai/errors";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_PROVIDER,
  createAnthropicProvider,
} from "@/lib/ai/providers/anthropic";
import {
  OPENAI_COMPATIBLE_PROVIDER,
  createOpenAiCompatibleProvider,
} from "@/lib/ai/providers/openai-compatible";
import type { AiProvider } from "@/lib/ai/types";

/**
 * Provider resolution.
 *
 * Deliberately the same shape as `lib/otp/providers/index.ts` and
 * `lib/media/storage/index.ts`: one environment variable names the provider,
 * resolution is memoised, an unknown name is a hard error rather than a silent
 * fallback, and a test can swap the whole thing out. Three capabilities in this
 * codebase are configured this way; a reader who has understood one has
 * understood all of them.
 *
 * ── Why unconfigured is a first-class state, not an error ──────────────────
 *
 * The application must work with no AI at all — that is the brief, and it is
 * also the honest default, since no provider ships with the app. So "no
 * `AI_PROVIDER` set" is not a fault: `isAiSearchAvailable()` returns false, the
 * Explore page renders without the assistant panel, and every manual filter
 * behaves exactly as it did before. Nothing is broken and nothing advertises a
 * feature that cannot run.
 *
 * That is why availability is computed here and passed down as a prop rather
 * than read in a component. A Client Component reading `process.env.AI_PROVIDER`
 * would inline `undefined` at build time and disagree with the server on first
 * render — the same trap `lib/properties/ai.ts` and `lib/maps/config.ts` both
 * document.
 *
 * ── Why a *misconfigured* provider is an error ─────────────────────────────
 *
 * `AI_PROVIDER=anthropic` with no `AI_API_KEY` is not "no AI"; it is somebody
 * who intended to enable it and will otherwise spend an afternoon wondering why
 * the panel never appears. So a named provider missing a credential throws
 * `AiNotConfiguredError` — surfaced in `/api/health` as a sentence naming the
 * variable, exactly as the media drivers do, and never to a visitor.
 *
 * ── Credentials ────────────────────────────────────────────────────────────
 *
 * `AI_API_KEY` is read here and passed to a provider constructor. It is not
 * `NEXT_PUBLIC_`-prefixed, so Next will not inline it into a client bundle; this
 * module is `server-only`, so an accidental client import is a build error
 * rather than a leak; and nothing in this file logs, returns or echoes the
 * value — `describeAiProvider` reports presence and names only.
 */

/** The provider names this build knows. */
export const AI_PROVIDERS = [ANTHROPIC_PROVIDER, OPENAI_COMPATIBLE_PROVIDER] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

let cached: AiProvider | null = null;
let override: AiProvider | null = null;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new AiNotConfiguredError(`${name} is not set`);
  return value;
}

/**
 * Which provider this deployment selected, or `null` for none.
 *
 * Blank and unset are both "none" — a `.env` line left as `AI_PROVIDER=` is
 * somebody who has not configured it yet, not a provider called "".
 */
export function resolveProviderName(): AiProviderName | null {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!configured || configured.length === 0) return null;

  if (!(AI_PROVIDERS as readonly string[]).includes(configured)) {
    throw new AiNotConfiguredError(
      `AI_PROVIDER="${configured}" is not a known provider (expected one of: ${AI_PROVIDERS.join(", ")})`
    );
  }

  return configured as AiProviderName;
}

function build(name: AiProviderName): AiProvider {
  switch (name) {
    case ANTHROPIC_PROVIDER:
      return createAnthropicProvider({
        apiKey: requireEnv("AI_API_KEY"),
        // Defaulted: there is exactly one correct endpoint for this provider, so
        // requiring it would be configuration for its own sake. Overridable for
        // a gateway.
        baseUrl: env("AI_BASE_URL") ?? ANTHROPIC_DEFAULT_BASE_URL,
        model: env("AI_MODEL") ?? ANTHROPIC_DEFAULT_MODEL,
      });

    case OPENAI_COMPATIBLE_PROVIDER:
      return createOpenAiCompatibleProvider({
        apiKey: requireEnv("AI_API_KEY"),
        // Required, and deliberately undefaulted: this provider is a wire
        // format, not a service. A default would send a visitor's search to
        // whichever vendor was hard-coded.
        baseUrl: requireEnv("AI_BASE_URL"),
        // Also required — there is no model name that is right for every
        // service speaking this format.
        model: requireEnv("AI_MODEL"),
      });
  }
}

/**
 * The configured provider, or `null` when none is configured.
 *
 * Memoised, because a provider resolves its configuration from the environment
 * once. Failures are deliberately *not* cached: a deployment that adds the
 * missing variable and restarts gets a working provider, and one that never had
 * it keeps getting the same clear error — the same rule
 * `lib/media/storage/index.ts` states.
 *
 * Throws `AiNotConfiguredError` when a provider is named but not usable. Returns
 * null only when none is named at all.
 */
export function getAiProvider(): AiProvider | null {
  if (override) return override;
  if (cached) return cached;

  const name = resolveProviderName();
  if (name === null) return null;

  cached = build(name);
  return cached;
}

/**
 * Whether AI search can be offered.
 *
 * Never throws: a misconfiguration is not a reason to take the marketplace's
 * front door down, so it reads as "not available" to a visitor and is reported
 * as a sentence in `/api/health` for whoever can fix it. The console line is the
 * only place the detail goes.
 */
export function isAiSearchAvailable(): boolean {
  try {
    return getAiProvider() !== null;
  } catch (error) {
    console.error("[ai] provider is configured but unusable:", error);
    return false;
  }
}

/**
 * Provider state for `/api/health`.
 *
 * Names and booleans only — never the key, never the URL with credentials in it.
 * The same contract every other entry in that response holds to.
 */
export function describeAiProvider(): {
  configured: boolean;
  provider?: string;
  model?: string;
  error?: string;
} {
  try {
    const provider = getAiProvider();
    if (!provider) return { configured: false };
    return { configured: true, provider: provider.name, model: provider.model };
  } catch (error) {
    return { configured: false, error: (error as Error).message };
  }
}

/** Test seam, matching `setMediaStorage` and `setRateLimitStore`. Lets a test
 *  drive the search pipeline against a stub with no network and no credential. */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}

export function resetAiProvider(): void {
  override = null;
  cached = null;
}
