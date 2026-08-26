import test from "node:test";
import assert from "node:assert/strict";

import { generateOtp, hashOtp, verifyOtp, normalizeOtpInput } from "../../lib/otp/code";
import { OTP_LENGTH } from "../../lib/otp/config";

// The module reads its secret lazily, inside each call, so setting it here is
// enough — no import-order gymnastics required.
process.env.OTP_SECRET = "test-otp-secret-value-long-enough";

const SESSION_A = "a".repeat(64);
const SESSION_B = "b".repeat(64);

test("generateOtp produces a fixed-length numeric code", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateOtp();
    assert.equal(code.length, OTP_LENGTH, `unexpected length for ${code}`);
    assert.match(code, /^[0-9]+$/, `non-numeric code ${code}`);
  }
});

test("generateOtp spans the whole space including leading zeros", () => {
  // A codepath that dropped leading zeros (e.g. String(n) without padding)
  // would shrink the space and be visible as a missing "0" first digit across
  // this many samples. 20k draws puts P(no leading zero | correct impl) at
  // about (0.9)^20000, i.e. nil.
  const firstDigits = new Set<string>();
  const seen = new Set<string>();
  for (let i = 0; i < 20_000; i += 1) {
    const code = generateOtp();
    firstDigits.add(code[0]);
    seen.add(code);
  }
  assert.ok(firstDigits.has("0"), "never generated a code starting with 0");
  assert.equal(firstDigits.size, 10, "first digit did not cover 0-9");
  // Sanity check on randomness: 20k draws from a 1M space should almost never
  // collapse to a small set of values.
  assert.ok(seen.size > 19_000, `suspiciously few distinct codes: ${seen.size}`);
});

test("hashOtp is deterministic for the same code and session", () => {
  const code = "123456";
  assert.equal(hashOtp(code, SESSION_A), hashOtp(code, SESSION_A));
});

test("hashOtp never stores the code in recoverable form", () => {
  const code = "123456";
  const digest = hashOtp(code, SESSION_A);
  assert.doesNotMatch(digest, /123456/, "digest contains the plaintext code");
  assert.equal(digest.length, 64, "expected a sha256 hex digest");
});

test("hashOtp is bound to the session, so a digest cannot be replayed elsewhere", () => {
  const code = "123456";
  assert.notEqual(
    hashOtp(code, SESSION_A),
    hashOtp(code, SESSION_B),
    "same code hashed identically across two sessions"
  );
});

test("hashOtp separates different codes", () => {
  assert.notEqual(hashOtp("123456", SESSION_A), hashOtp("123457", SESSION_A));
});

test("verifyOtp accepts the correct code", () => {
  const code = "042917";
  assert.equal(verifyOtp(code, hashOtp(code, SESSION_A), SESSION_A), true);
});

test("verifyOtp rejects an incorrect code", () => {
  const stored = hashOtp("042917", SESSION_A);
  assert.equal(verifyOtp("042918", stored, SESSION_A), false);
  assert.equal(verifyOtp("000000", stored, SESSION_A), false);
  assert.equal(verifyOtp("", stored, SESSION_A), false);
});

test("verifyOtp rejects the right code presented against the wrong session", () => {
  const code = "042917";
  const stored = hashOtp(code, SESSION_A);
  assert.equal(
    verifyOtp(code, stored, SESSION_B),
    false,
    "a code accepted under another session's binding"
  );
});

test("verifyOtp rejects malformed stored digests instead of throwing", () => {
  assert.equal(verifyOtp("123456", "", SESSION_A), false);
  assert.equal(verifyOtp("123456", "not-hex", SESSION_A), false);
  assert.equal(verifyOtp("123456", "ab", SESSION_A), false);
});

test("verifyOtp is sensitive to a leading-zero difference", () => {
  // "12345" padded and "012345" must not collide.
  const stored = hashOtp("012345", SESSION_A);
  assert.equal(verifyOtp("012345", stored, SESSION_A), true);
  assert.equal(verifyOtp("123450", stored, SESSION_A), false);
});

test("normalizeOtpInput strips separators a user might paste", () => {
  assert.equal(normalizeOtpInput("123 456"), "123456");
  assert.equal(normalizeOtpInput("123-456"), "123456");
  assert.equal(normalizeOtpInput(" 1 2 3 4 5 6 "), "123456");
  assert.equal(normalizeOtpInput("abc"), "");
});

// ─────────────────────────────────────────────────────────────
// OTP_SECRET is required and stands alone
// ─────────────────────────────────────────────────────────────

/**
 * The secret is read lazily inside each call rather than captured at import, so
 * these cases can simply change the environment and call again — no module
 * cache juggling needed.
 */
function withSecretEnv(
  overrides: Record<string, string | undefined>,
  run: () => void
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("hashing refuses to run without OTP_SECRET", () => {
  withSecretEnv({ OTP_SECRET: undefined }, () => {
    assert.throws(() => hashOtp("123456", SESSION_A), /OTP_SECRET is missing or too short/);
  });
});

test("a too-short OTP_SECRET is rejected", () => {
  withSecretEnv({ OTP_SECRET: "tooshort" }, () => {
    assert.throws(() => hashOtp("123456", SESSION_A), /OTP_SECRET is missing or too short/);
  });
});

test("OTP_SECRET does NOT fall back to PASSWORD_RESET_SECRET", () => {
  // The whole point of a separate secret is that one leaked value does not
  // compromise both recovery tokens and passcode digests. A fallback would
  // quietly undo that on any deployment that never set OTP_SECRET.
  withSecretEnv(
    {
      OTP_SECRET: undefined,
      PASSWORD_RESET_SECRET: "a-perfectly-valid-reset-secret-value",
    },
    () => {
      assert.throws(
        () => hashOtp("123456", SESSION_A),
        /OTP_SECRET is missing or too short/,
        "passcode hashing silently fell back to PASSWORD_RESET_SECRET"
      );
    }
  );
});

test("the failure never discloses a secret value", () => {
  // Distinctive sentinel values that could not legitimately appear in a
  // diagnostic message, so a match really does mean a leak. (Using something
  // like "short" as the value would collide with the message's own wording.)
  withSecretEnv(
    {
      // 9 characters — under the 16-character minimum, so this throws.
      OTP_SECRET: "qqzz-leak",
      PASSWORD_RESET_SECRET: "qqzz-leaky-reset-sentinel-value",
      AUTH_SECRET: "qqzz-leaky-auth-sentinel-value",
    },
    () => {
      try {
        hashOtp("123456", SESSION_A);
        assert.fail("expected a throw — the sentinel is under the 16-character minimum");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert.doesNotMatch(message, /qqzz-leaky/, "an error message leaked a secret value");
      }
    }
  );
});

test("a distinct OTP_SECRET produces distinct digests", () => {
  const code = "123456";
  let underFirst = "";
  let underSecond = "";
  withSecretEnv({ OTP_SECRET: "first-otp-secret-value-long-enough" }, () => {
    underFirst = hashOtp(code, SESSION_A);
  });
  withSecretEnv({ OTP_SECRET: "second-otp-secret-value-long-enough" }, () => {
    underSecond = hashOtp(code, SESSION_A);
  });
  assert.notEqual(underFirst, underSecond, "digest did not depend on the secret");
});
