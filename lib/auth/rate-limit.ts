import "server-only";

/**
 * Rate limiting.
 *
 * ── Current implementation: in-memory, single-instance ──────────────────────
 *
 * The default store is a plain `Map` in one Node process's memory. That has two
 * consequences, and neither is a bug so much as a deployment boundary:
 *
 *  - It resets on every restart. A process that restarts mid-attack hands the
 *    attacker a fresh budget.
 *  - It is NOT shared across instances. Behind a load balancer, on serverless,
 *    or with more than one container, each instance keeps its own counters, so
 *    the effective limit is (configured limit x number of instances).
 *
 * This is correct and sufficient for development and for a genuine
 * single-instance deployment, which is what this milestone targets. It is not
 * sufficient for a horizontally scaled one.
 *
 * ── Replacing it later without touching OTP logic ───────────────────────────
 *
 * The passcode flow does not call the Map. It calls `checkRateLimit`, which
 * delegates to whatever `RateLimitStore` is installed. To move to Redis,
 * Upstash, or a database counter, implement `RateLimitStore` and install it once
 * at startup:
 *
 *     setRateLimitStore(new MyRedisRateLimitStore(...));
 *
 * No route, and nothing in `lib/otp/`, changes. `checkRateLimit` is already
 * async precisely so that a network-backed store slots in without turning a
 * synchronous call site into an asynchronous one later.
 *
 * No such dependency is added here: Upstash is not installed in this project and
 * this task does not add it.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * The swap point. A single method, deliberately: "record one hit against this
 * key and tell me whether it is allowed" is the whole contract, and it maps
 * cleanly onto a Redis `INCR` + `EXPIRE` or an Upstash sliding-window call.
 *
 * Implementations may be async; `checkRateLimit` awaits the result either way.
 */
export interface RateLimitStore {
  /** Short identifier for diagnostics — never user-facing. */
  readonly name: string;
  consume(
    compositeKey: string,
    limit: number,
    windowMs: number
  ): RateLimitResult | Promise<RateLimitResult>;
}

/**
 * The original sliding-window counter, unchanged.
 *
 * Kept exactly as it was: first hit in a window starts a new one, hits beyond
 * the limit are refused with the time remaining, everything else decrements the
 * allowance.
 */
class InMemoryRateLimitStore implements RateLimitStore {
  readonly name = "in-memory";

  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  consume(compositeKey: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.buckets.get(compositeKey);

    if (!entry || now - entry.windowStart >= windowMs) {
      this.buckets.set(compositeKey, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
    }

    if (entry.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: windowMs - (now - entry.windowStart),
      };
    }

    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 };
  }
}

/**
 * The in-memory store is also held as a concrete reference, not just as the
 * installed store, because the synchronous `rateLimit` below can only ever use
 * it — see the note there.
 */
const inMemoryStore = new InMemoryRateLimitStore();

let activeStore: RateLimitStore = inMemoryStore;

/** Installs a different store. Call once during startup, before serving traffic. */
export function setRateLimitStore(store: RateLimitStore): void {
  activeStore = store;
}

/** Which store is installed. For diagnostics and tests, never sent to a client. */
export function getRateLimitStoreName(): string {
  return activeStore.name;
}

/** Restores the default in-memory store. Used by tests to isolate cases. */
export function resetRateLimitStore(): void {
  activeStore = inMemoryStore;
}

function compositeKey(bucket: string, key: string): string {
  return `${bucket}:${key}`;
}

/**
 * Records a hit against (bucket, key) and reports whether it is allowed.
 *
 * This is the entry point the passcode flow uses. It is async so that swapping
 * in a network-backed store is a configuration change rather than a refactor of
 * every call site.
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  return activeStore.consume(compositeKey(bucket, key), limit, windowMs);
}

/**
 * Synchronous limiter, retained for the signup and login routes.
 *
 * It is pinned to the in-memory store rather than the installed one, and that is
 * intentional: a synchronous signature cannot await a network round-trip, so
 * pretending it honours a Redis store would be a silent lie — those routes would
 * quietly keep using per-process counters after a swap. Migrating them is a
 * one-line change each (`await checkRateLimit(...)`), left out of this task to
 * avoid touching authentication paths that were not in scope.
 */
export function rateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  return inMemoryStore.consume(compositeKey(bucket, key), limit, windowMs);
}

/** Best-effort client IP extraction behind common proxies/load balancers. */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
