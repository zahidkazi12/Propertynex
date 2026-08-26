/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LIVE OTP DELIVERY SMOKE TEST                                            ║
 * ║  THIS SENDS A REAL EMAIL AND/OR A REAL SMS. IT MAY COST MONEY.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Exercises the one part of the OTP layer that no other test can reach: the
 * actual HTTP request to Resend / Twilio. Everything else — code generation,
 * hashing, expiry, attempt limits, enumeration behaviour — is covered by the
 * unit and integration suites against the console provider. What those cannot
 * verify is whether a real provider accepts our request shape, our auth header,
 * and our destination format. That is what this does.
 *
 * It goes through the real `getOtpProvider()` and the real provider classes, so
 * it tests the shipped code path rather than a reimplementation of it.
 *
 * Usage (compile first — this is TypeScript, built by tests/tsconfig.json):
 *
 *   npx tsc -p tests/tsconfig.json
 *   node "tests/.build/tests/integration/otp-live-smoke.js" --channel email --to you@example.com
 *   node "tests/.build/tests/integration/otp-live-smoke.js" --channel sms   --to +15551234567
 *   node "tests/.build/tests/integration/otp-live-smoke.js" --channel both
 *
 * Credentials come from the environment at run time and nowhere else. Pass them
 * the way you pass any secret — an env file your platform injects, or inline for
 * one command:
 *
 *   OTP_EMAIL_PROVIDER=resend RESEND_API_KEY=... OTP_EMAIL_FROM='...' \
 *     node "tests/.build/tests/integration/otp-live-smoke.js" --channel email --to you@example.com
 *
 * Safety properties, all deliberate:
 *
 *   - Nothing is written to disk. No credential is read from or persisted to a
 *     file by this script.
 *   - No secret is ever printed. Credentials are reported as SET / not set by
 *     NAME only, never by value.
 *   - The passcode itself is never printed either. Receiving it in your inbox or
 *     on your phone *is* the test result; echoing a live code into a terminal or
 *     a CI log is the habit this codebase avoids everywhere else.
 *   - Anything printed is passed through `redact()` first, which strips any
 *     configured credential value and the generated passcode from the output.
 *     Provider error bodies can echo request content back (Twilio, for one,
 *     quotes the message body in some 400s), so this matters for failure output,
 *     not just for the happy path.
 *   - It refuses to send without explicit confirmation. Interactively you must
 *     type SEND; non-interactively you must set OTP_LIVE_SMOKE_CONFIRM=SEND.
 *   - It never touches OTP_SECRET. Nothing here hashes anything — `generateOtp`
 *     needs no secret — so the script has no reason to read it and does not.
 */
import "../stubs/patch-server-only";

import { createInterface } from "node:readline/promises";
import { generateOtp } from "../../lib/otp/code";
import { OTP_TTL_MINUTES } from "../../lib/otp/config";
import { getOtpProvider } from "../../lib/otp/providers/index";
import { OtpProviderNotConfiguredError } from "../../lib/otp/providers/types";
import type { OtpChannel } from "../../lib/otp/providers/types";
import { parseIdentifier, maskIdentifier, toE164 } from "../../lib/utils/identifier";

/** Credential variables, by channel. Only ever inspected for presence. */
const CREDENTIAL_VARS: Record<OtpChannel, string[]> = {
  EMAIL: ["OTP_EMAIL_PROVIDER", "RESEND_API_KEY", "OTP_EMAIL_FROM"],
  SMS: ["OTP_SMS_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OTP_SMS_FROM"],
};

/**
 * Values that must never appear in output.
 *
 * Built from whatever is actually set in the environment, so it adapts to
 * whichever provider is configured, plus the passcode once generated. Short
 * values are skipped: redacting a 1-2 character string would mangle unrelated
 * text without protecting anything meaningful.
 */
const secretsToRedact = new Set<string>();

function registerSecretsFromEnv(): void {
  const sensitive = [
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "OTP_SECRET",
    "PASSWORD_RESET_SECRET",
    "AUTH_SECRET",
    "DATABASE_URL",
  ];
  for (const name of sensitive) {
    const value = process.env[name];
    if (value && value.trim().length >= 6) secretsToRedact.add(value.trim());
  }
}

function redact(text: string): string {
  let out = text;
  for (const secret of secretsToRedact) {
    out = out.split(secret).join("«redacted»");
  }
  return out;
}

function say(text: string): void {
  console.log(redact(text));
}

function warn(text: string): void {
  console.error(redact(text));
}

interface Args {
  channels: OtpChannel[];
  to?: string;
}

function parseArgs(argv: string[]): Args {
  let channelArg = "both";
  let to: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--channel" && argv[i + 1]) {
      channelArg = argv[i + 1].toLowerCase();
      i += 1;
    } else if (argv[i] === "--to" && argv[i + 1]) {
      to = argv[i + 1];
      i += 1;
    }
  }

  const channels: OtpChannel[] =
    channelArg === "email"
      ? ["EMAIL"]
      : channelArg === "sms"
        ? ["SMS"]
        : channelArg === "both"
          ? ["EMAIL", "SMS"]
          : [];

  if (channels.length === 0) {
    throw new Error(`--channel must be one of: email, sms, both (got "${channelArg}")`);
  }

  return { channels, to };
}

/**
 * Where to send. `--to` wins; otherwise the per-channel env var. There is no
 * default — a live test must not guess at a destination.
 */
function resolveDestination(channel: OtpChannel, explicit: string | undefined): string {
  const fromEnv =
    channel === "EMAIL" ? process.env.OTP_SMOKE_EMAIL_TO : process.env.OTP_SMOKE_SMS_TO;
  const raw = (explicit ?? fromEnv ?? "").trim();

  if (!raw) {
    const varName = channel === "EMAIL" ? "OTP_SMOKE_EMAIL_TO" : "OTP_SMOKE_SMS_TO";
    throw new Error(`no destination for ${channel}: pass --to <value> or set ${varName}`);
  }

  const parsed = parseIdentifier(raw);
  if (!parsed) {
    throw new Error(`destination for ${channel} is not a valid email address or phone number`);
  }
  if (channel === "EMAIL" && parsed.kind !== "EMAIL") {
    throw new Error("--channel email needs an email address as the destination");
  }
  if (channel === "SMS" && parsed.kind !== "PHONE") {
    throw new Error("--channel sms needs a phone number as the destination");
  }

  // Mirror exactly what the recovery routes do: E.164 for SMS, address as-is for
  // email. Testing a different format than production sends would defeat the
  // purpose of this script.
  return channel === "EMAIL" ? parsed.value : toE164(parsed.raw);
}

interface Plan {
  channel: OtpChannel;
  providerName: string;
  destination: string;
  masked: string;
  isDevProvider: boolean;
}

function buildPlan(channel: OtpChannel, to: string | undefined): Plan {
  const provider = getOtpProvider(channel); // throws if not configured
  const destination = resolveDestination(channel, to);
  const parsed = parseIdentifier(destination);

  return {
    channel,
    providerName: provider.name,
    destination,
    masked: parsed ? maskIdentifier(parsed) : "«unparseable»",
    isDevProvider: provider.name === "console",
  };
}

async function confirm(plans: Plan[]): Promise<boolean> {
  const anyLive = plans.some((plan) => !plan.isDevProvider);

  say("");
  if (anyLive) {
    say("  ⚠  THIS WILL SEND REAL MESSAGES TO REAL DESTINATIONS.");
    say("     Real email and/or SMS. Provider charges may apply.");
  } else {
    say("  ℹ  Every channel resolved to the DEVELOPMENT console provider.");
    say("     Nothing will actually be delivered — this is a dry run.");
  }
  say("");

  const expected = "SEND";

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`  Type ${expected} to proceed (anything else aborts): `);
      return answer.trim() === expected;
    } finally {
      rl.close();
    }
  }

  // Non-interactive (CI, piped shell): an env var is the only way through, so a
  // stray invocation cannot send anything.
  const confirmVar = process.env.OTP_LIVE_SMOKE_CONFIRM?.trim();
  if (confirmVar === expected) {
    say(`  Confirmation accepted via OTP_LIVE_SMOKE_CONFIRM=${expected}.`);
    return true;
  }

  warn("  stdin is not a TTY and OTP_LIVE_SMOKE_CONFIRM is not set to SEND — aborting.");
  warn(`  Re-run with OTP_LIVE_SMOKE_CONFIRM=${expected} to confirm non-interactively.`);
  return false;
}

async function main(): Promise<number> {
  registerSecretsFromEnv();

  say("");
  say("╔════════════════════════════════════════════════════════════════════╗");
  say("║  PROPERTYNEX — LIVE OTP DELIVERY SMOKE TEST                         ║");
  say("║  Sends a REAL passcode through the configured provider.             ║");
  say("╚════════════════════════════════════════════════════════════════════╝");

  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    warn(`\n  ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Credential presence, by NAME only. Never the value.
  say("\n  Environment (names only — no values are read for display):");
  for (const channel of args.channels) {
    for (const name of CREDENTIAL_VARS[channel]) {
      const value = process.env[name];
      const state = value && value.trim() ? "SET" : "not set";
      say(`    ${name.padEnd(20)} ${state}`);
    }
  }

  const plans: Plan[] = [];
  const setupErrors: string[] = [];

  for (const channel of args.channels) {
    try {
      plans.push(buildPlan(channel, args.to));
    } catch (error) {
      if (error instanceof OtpProviderNotConfiguredError) {
        setupErrors.push(`${channel}: no usable provider — ${error.message}`);
      } else {
        setupErrors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (setupErrors.length > 0) {
    warn("\n  Cannot test:");
    for (const message of setupErrors) warn(`    - ${message}`);
  }

  if (plans.length === 0) {
    warn("\n  Nothing to send. Configure a provider and a destination, then re-run.");
    return 1;
  }

  say("\n  Planned sends:");
  for (const plan of plans) {
    const label = plan.isDevProvider ? " (development provider — no real delivery)" : "";
    say(`    ${plan.channel.padEnd(6)} via ${plan.providerName.padEnd(8)} -> ${plan.masked}${label}`);
  }
  say(`\n  Passcode: 6 digits, valid ${OTP_TTL_MINUTES} minutes.`);
  say("  The code is NOT printed here — receiving it is the test result.");

  if (!(await confirm(plans))) {
    say("\n  Aborted. Nothing was sent.");
    return 1;
  }

  say("");
  let failures = 0;

  for (const plan of plans) {
    // A throwaway code: it belongs to no recovery session and cannot reset any
    // password. Registered for redaction so a provider error that echoes the
    // message body cannot surface it.
    const code = generateOtp();
    secretsToRedact.add(code);

    process.stdout.write(`  ${plan.channel.padEnd(6)} via ${plan.providerName.padEnd(8)} ... `);
    const startedAt = Date.now();

    try {
      const provider = getOtpProvider(plan.channel);
      await provider.send({
        channel: plan.channel,
        destination: plan.destination,
        code,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
      console.log(`accepted in ${Date.now() - startedAt}ms`);
    } catch (error) {
      failures += 1;
      console.log("FAILED");
      warn(`      ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  say("");
  if (failures > 0) {
    warn(`  ${failures} of ${plans.length} channel(s) failed. See the messages above.`);
    warn("  Common causes: unverified sender domain (Resend), trial-account");
    warn("  destination restrictions or a non-E.164 number (Twilio), wrong region.");
    return 1;
  }

  say(`  All ${plans.length} channel(s) accepted by the provider.`);
  say("  Provider acceptance is not delivery — now check the actual inbox/handset.");
  const live = plans.filter((plan) => !plan.isDevProvider);
  if (live.length === 0) {
    say("  (Dev provider only: the code was printed above by the console provider.)");
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    warn(`\n  Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
