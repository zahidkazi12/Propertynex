// Must come first: installs the `server-only` resolution patch before the
// rate limiter is loaded. See tests/stubs/patch-server-only.ts.
import "../stubs/patch-server-only";

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  rateLimit,
  setRateLimitStore,
  resetRateLimitStore,
  getRateLimitStoreName,
  getClientIp,
  type RateLimitResult,
  type RateLimitStore,
} from "../../lib/auth/rate-limit";

/**
 * The rate limiter's swap seam.
 *
 * The point of these cases is not to re-test the sliding window (unchanged) but
 * to pin down the property the cleanup was asked for: **a shared Redis/Upstash
 * store can replace the in-memory one without any change to OTP business
 * logic.** That holds only if `checkRateLimit` really delegates to the installed
 * store and really tolerates an async one.
 */

test("the default store is the in-memory one", () => {
  resetRateLimitStore();
  assert.equal(getRateLimitStoreName(), "in-memory");
});

test("the sliding window still behaves as before", async () => {
  resetRateLimitStore();
  const key = `case-${Date.now()}-a`;

  const first = await checkRateLimit("test", key, 3, 60_000);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 2);

  assert.equal((await checkRateLimit("test", key, 3, 60_000)).remaining, 1);
  assert.equal((await checkRateLimit("test", key, 3, 60_000)).remaining, 0);

  const refused = await checkRateLimit("test", key, 3, 60_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterMs > 0, "no retry hint on a refused request");
});

test("buckets and keys are independent", async () => {
  resetRateLimitStore();
  const stamp = Date.now();

  await checkRateLimit("bucket-a", `k-${stamp}`, 1, 60_000);
  const otherKey = await checkRateLimit("bucket-a", `other-${stamp}`, 1, 60_000);
  const otherBucket = await checkRateLimit("bucket-b", `k-${stamp}`, 1, 60_000);

  assert.equal(otherKey.allowed, true, "a different key shared a budget");
  assert.equal(otherBucket.allowed, true, "a different bucket shared a budget");

  const sameAgain = await checkRateLimit("bucket-a", `k-${stamp}`, 1, 60_000);
  assert.equal(sameAgain.allowed, false, "the same bucket+key did not share a budget");
});

test("an expired window starts fresh", async () => {
  resetRateLimitStore();
  const key = `case-${Date.now()}-b`;

  // A 1ms window is expired by the time the second call lands.
  await checkRateLimit("test", key, 1, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const afterWindow = await checkRateLimit("test", key, 1, 1);
  assert.equal(afterWindow.allowed, true, "window did not roll over");
});

/** A stand-in for a Redis/Upstash-backed store: async, and external to this process. */
class RecordingAsyncStore implements RateLimitStore {
  readonly name = "recording-async";
  readonly calls: Array<{ key: string; limit: number; windowMs: number }> = [];

  constructor(private readonly verdict: RateLimitResult) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    this.calls.push({ key, limit, windowMs });
    // A real network store resolves on a later tick; make sure that is fine.
    await new Promise((resolve) => setImmediate(resolve));
    return this.verdict;
  }
}

test("checkRateLimit delegates to an installed async store", async () => {
  const store = new RecordingAsyncStore({ allowed: false, remaining: 0, retryAfterMs: 4_242 });
  setRateLimitStore(store);
  try {
    assert.equal(getRateLimitStoreName(), "recording-async");

    const result = await checkRateLimit("otp-start-ip", "203.0.113.7", 8, 600_000);

    assert.deepEqual(result, { allowed: false, remaining: 0, retryAfterMs: 4_242 });
    assert.equal(store.calls.length, 1, "the installed store was not consulted");
    assert.deepEqual(store.calls[0], {
      // Bucket and key are combined into one opaque string, which is what a
      // Redis key would be.
      key: "otp-start-ip:203.0.113.7",
      limit: 8,
      windowMs: 600_000,
    });
  } finally {
    resetRateLimitStore();
  }
});

test("a store swap needs no change to the calling convention", async () => {
  // The same call, against two different stores, differing only in verdict —
  // which is exactly what "swap the store without touching OTP logic" means.
  const permissive = new RecordingAsyncStore({ allowed: true, remaining: 5, retryAfterMs: 0 });
  setRateLimitStore(permissive);
  try {
    assert.equal((await checkRateLimit("otp-verify-ip", "ip", 20, 600_000)).allowed, true);
  } finally {
    resetRateLimitStore();
  }

  const restrictive = new RecordingAsyncStore({ allowed: false, remaining: 0, retryAfterMs: 1 });
  setRateLimitStore(restrictive);
  try {
    assert.equal((await checkRateLimit("otp-verify-ip", "ip", 20, 600_000)).allowed, false);
  } finally {
    resetRateLimitStore();
  }
});

test("resetRateLimitStore restores the in-memory default", async () => {
  setRateLimitStore(new RecordingAsyncStore({ allowed: false, remaining: 0, retryAfterMs: 1 }));
  resetRateLimitStore();
  assert.equal(getRateLimitStoreName(), "in-memory");
  assert.equal((await checkRateLimit("test", `restore-${Date.now()}`, 2, 60_000)).allowed, true);
});

test("the synchronous rateLimit stays on the in-memory store by design", async () => {
  // Documented deliberate behaviour: a synchronous signature cannot await a
  // network round-trip, so signup/login keep per-process counters until they are
  // migrated to checkRateLimit. Pretending otherwise would be a silent lie.
  const store = new RecordingAsyncStore({ allowed: false, remaining: 0, retryAfterMs: 9_999 });
  setRateLimitStore(store);
  try {
    const result = rateLimit("signup", `sync-${Date.now()}`, 5, 60_000);
    assert.equal(result.allowed, true, "sync limiter unexpectedly used the installed store");
    assert.equal(store.calls.length, 0, "sync limiter consulted the installed store");
  } finally {
    resetRateLimitStore();
  }
});

test("getClientIp prefers x-forwarded-for, then x-real-ip, then unknown", () => {
  const withHeaders = (headers: Record<string, string>) =>
    getClientIp(new Request("https://example.com", { headers }));

  assert.equal(withHeaders({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }), "203.0.113.5");
  assert.equal(withHeaders({ "x-forwarded-for": "  203.0.113.5  " }), "203.0.113.5");
  assert.equal(withHeaders({ "x-real-ip": "198.51.100.9" }), "198.51.100.9");
  assert.equal(withHeaders({}), "unknown");
});
