/**
 * Production fail-closed verification for OTP delivery.
 *
 * Run against a `next start` server (NODE_ENV=production) with no OTP provider
 * configured. Asserts the two things item 2 asks to verify:
 *
 *   1. Production refuses to send a passcode without a configured provider —
 *      it returns a generic 503 rather than pretending delivery succeeded.
 *   2. No passcode is emitted anywhere: not in the response, not in the server
 *      log. That is the "console provider is unusable in production" guarantee
 *      observed from outside, on a real production build.
 *
 * It also checks the failure stays enumeration-safe: an unknown identifier and a
 * real one must fail identically, because provider configuration is checked
 * before the account lookup.
 */
import { readFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3101";
const LOG_PATH = process.env.PROD_LOG_PATH ?? "prod-server.log";

const logBefore = (await readFile(LOG_PATH, "utf8").catch(() => "")).length;

async function start(identifier, channelNote) {
  const response = await fetch(`${BASE_URL}/api/auth/forgot-password/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.77" },
    body: JSON.stringify({ identifier }),
  });
  const text = await response.text();
  return { status: response.status, text, channelNote };
}

const results = [
  await start("someone.real.or.not@example.com", "email"),
  await start("definitely-not-registered-9182@example.com", "email (unknown)"),
  await start("+1 555 010 9911", "sms"),
];

const failures = [];

for (const result of results) {
  if (result.status !== 503) {
    failures.push(`${result.channelNote}: expected 503, got ${result.status} — ${result.text}`);
  }
  if (!/temporarily unavailable/i.test(result.text)) {
    failures.push(`${result.channelNote}: response was not the generic unavailable message`);
  }
  if (/\b\d{6}\b/.test(result.text)) {
    failures.push(`${result.channelNote}: a 6-digit value appeared in the response body`);
  }
  if (/recoveryToken/.test(result.text)) {
    failures.push(`${result.channelNote}: a recovery token was issued despite no provider`);
  }
}

// Email and unknown-email must be byte-identical: the provider check runs before
// the account lookup, so a config fault must not become an existence oracle.
if (results[0].text !== results[1].text || results[0].status !== results[1].status) {
  failures.push("existing and unknown identifiers produced different failure responses");
}

const logAfter = await readFile(LOG_PATH, "utf8").catch(() => "");
const freshLog = logAfter.slice(logBefore);

if (/passcode:/i.test(freshLog)) {
  failures.push("the server log contains a 'passcode:' line — console provider ran in production");
}
if (/development OTP delivery/i.test(freshLog)) {
  failures.push("the console provider's banner appeared in a production log");
}
if (!/provider not configured/i.test(freshLog)) {
  failures.push("expected a server-side 'provider not configured' diagnostic; none found");
}

console.log(`statuses:            ${results.map((r) => r.status).join(", ")}`);
console.log(`generic message:     ${/temporarily unavailable/i.test(results[0].text)}`);
console.log(`token issued:        ${/recoveryToken/.test(results[0].text)}`);
console.log(`real vs unknown identical: ${results[0].text === results[1].text}`);
console.log(`passcode in log:     ${/passcode:/i.test(freshLog)}`);
console.log(`diagnostic logged:   ${/provider not configured/i.test(freshLog)}`);

if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: production is fail-closed and emits no passcode.");
}
