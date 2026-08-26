import test from "node:test";
import assert from "node:assert/strict";

import {
  parseIdentifier,
  normalizePhoneDigits,
  maskIdentifier,
  identifierRateKey,
} from "../../lib/utils/identifier";

test("parseIdentifier recognises email addresses", () => {
  const parsed = parseIdentifier("  Jane.Doe@Example.COM ");
  assert.deepEqual(parsed, {
    kind: "EMAIL",
    value: "jane.doe@example.com",
    raw: "Jane.Doe@Example.COM",
  });
});

test("parseIdentifier recognises phone numbers in assorted formats", () => {
  for (const input of [
    "+91 98765 43210",
    "+919876543210",
    "919876543210",
    "(91) 98765-43210",
    "98765 43210",
  ]) {
    const parsed = parseIdentifier(input);
    assert.equal(parsed?.kind, "PHONE", `failed to parse ${input}`);
    assert.match(parsed!.value, /^[0-9]+$/, `value not digits-only for ${input}`);
  }
});

test("parseIdentifier normalizes phone formatting to a single canonical value", () => {
  const a = parseIdentifier("+91 98765 43210");
  const b = parseIdentifier("+919876543210");
  const c = parseIdentifier("(91) 98765-43210");
  assert.equal(a?.value, "919876543210");
  assert.equal(b?.value, "919876543210");
  assert.equal(c?.value, "919876543210");
});

test("parseIdentifier rejects values that are neither", () => {
  for (const input of [
    "",
    "   ",
    "notanemail",
    "no@at",
    "@example.com",
    "missing@domain",
    "spaces in@email.com",
    "1((((((((",
    "12345", // too short to be a phone number
    "----",
  ]) {
    assert.equal(parseIdentifier(input), null, `should have rejected ${JSON.stringify(input)}`);
  }
});

test("parseIdentifier treats a malformed value containing @ as a bad email, not a phone", () => {
  // Reported as invalid rather than silently reinterpreted.
  assert.equal(parseIdentifier("9876543210@"), null);
});

test("normalizePhoneDigits keeps only digits", () => {
  assert.equal(normalizePhoneDigits("+91 (98765)-43210"), "919876543210");
  assert.equal(normalizePhoneDigits("abc"), "");
});

test("maskIdentifier hides the local part of an email but keeps it recognisable", () => {
  const masked = maskIdentifier(parseIdentifier("jonathan@example.com")!);
  assert.ok(masked.startsWith("j"), masked);
  assert.ok(masked.endsWith("n@example.com"), masked);
  assert.doesNotMatch(masked, /jonathan/, "full local part leaked");
});

test("maskIdentifier handles very short email local parts", () => {
  const masked = maskIdentifier(parseIdentifier("ab@example.com")!);
  assert.doesNotMatch(masked, /^ab@/, "did not mask a two-character local part");
  assert.ok(masked.includes("@example.com"), masked);
});

test("maskIdentifier reveals only the last four digits of a phone number", () => {
  const masked = maskIdentifier(parseIdentifier("+91 98765 43210")!);
  assert.ok(masked.endsWith("3210"), masked);
  assert.doesNotMatch(masked, /9876/, "leaked more than the last four digits");
});

test("identifierRateKey is stable, opaque, and distinguishes identifiers", () => {
  const a = parseIdentifier("jane@example.com")!;
  const b = parseIdentifier("john@example.com")!;

  assert.equal(identifierRateKey(a), identifierRateKey(a), "key is not stable");
  assert.notEqual(identifierRateKey(a), identifierRateKey(b), "distinct identifiers collided");
  assert.doesNotMatch(identifierRateKey(a), /jane|example/, "raw identifier leaked into key");
  assert.match(identifierRateKey(a), /^[0-9a-f]{32}$/);
});

test("identifierRateKey buckets equivalent phone formats together", () => {
  // Two spellings of one number must share a bucket, or per-identifier rate
  // limiting is trivially bypassed by adding a space.
  const a = parseIdentifier("+91 98765 43210")!;
  const b = parseIdentifier("+919876543210")!;
  assert.equal(identifierRateKey(a), identifierRateKey(b));
});
