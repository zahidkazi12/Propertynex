import "server-only";
import { ConsoleOtpProvider } from "./console";
import { ResendOtpProvider } from "./resend";
import { TwilioOtpProvider } from "./twilio";
import {
  OtpProviderNotConfiguredError,
  type OtpChannel,
  type OtpProvider,
} from "./types";

/**
 * Resolves the delivery provider for a channel from environment variables.
 *
 * The policy is fail-closed. If a channel has no provider configured, or the
 * selected provider is missing a credential, this throws — the recovery flow
 * then discards the session and returns a generic error. It never falls back
 * to "pretend we sent it", because a passcode the user cannot receive is a
 * silently broken account-recovery path, and it never falls back to the
 * console provider outside development.
 *
 * Configuration:
 *
 *   OTP_EMAIL_PROVIDER = console | resend
 *   OTP_SMS_PROVIDER   = console | twilio
 *
 * with the credentials each one needs (see .env.example). No value is
 * hard-coded here and no credential has a default.
 */

let emailProvider: OtpProvider | null = null;
let smsProvider: OtpProvider | null = null;

function requireEnv(name: string, channel: OtpChannel): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new OtpProviderNotConfiguredError(channel, `${name} is not set`);
  }
  return value.trim();
}

function buildEmailProvider(): OtpProvider {
  // In development an unset provider defaults to `console` so the flow is
  // usable out of the box; in production it is an explicit configuration error.
  const selected =
    process.env.OTP_EMAIL_PROVIDER?.trim().toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "" : "console");

  switch (selected) {
    case "console":
      return new ConsoleOtpProvider();
    case "resend":
      return new ResendOtpProvider(
        requireEnv("RESEND_API_KEY", "EMAIL"),
        requireEnv("OTP_EMAIL_FROM", "EMAIL")
      );
    case "":
      throw new OtpProviderNotConfiguredError("EMAIL", "OTP_EMAIL_PROVIDER is not set");
    default:
      throw new OtpProviderNotConfiguredError(
        "EMAIL",
        `unknown provider "${selected}" (expected: console, resend)`
      );
  }
}

function buildSmsProvider(): OtpProvider {
  const selected =
    process.env.OTP_SMS_PROVIDER?.trim().toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "" : "console");

  switch (selected) {
    case "console":
      return new ConsoleOtpProvider();
    case "twilio":
      return new TwilioOtpProvider(
        requireEnv("TWILIO_ACCOUNT_SID", "SMS"),
        requireEnv("TWILIO_AUTH_TOKEN", "SMS"),
        requireEnv("OTP_SMS_FROM", "SMS")
      );
    case "":
      throw new OtpProviderNotConfiguredError("SMS", "OTP_SMS_PROVIDER is not set");
    default:
      throw new OtpProviderNotConfiguredError(
        "SMS",
        `unknown provider "${selected}" (expected: console, twilio)`
      );
  }
}

/**
 * Normalises anything thrown while constructing a provider into
 * `OtpProviderNotConfiguredError`.
 *
 * Provider constructors validate their own inputs and throw plain `Error`s —
 * `ConsoleOtpProvider` refuses to exist in production, `TwilioOtpProvider`
 * rejects a malformed account SID. Those are configuration faults just as much
 * as a missing variable is, but the routes distinguish "this channel is not
 * usable" (generic 503, "temporarily unavailable") from an unexpected crash
 * (500) by error *type*. Without this funnel, asking for the console provider in
 * production produced a bare 500 with no explanation of why — technically safe,
 * since nothing was sent, but it reads as a crash instead of a misconfiguration
 * and buries the one diagnostic an operator needs.
 *
 * The original message is preserved for the server-side log; it never reaches a
 * client.
 */
function resolveProvider(channel: OtpChannel, build: () => OtpProvider): OtpProvider {
  try {
    return build();
  } catch (error) {
    if (error instanceof OtpProviderNotConfiguredError) throw error;
    throw new OtpProviderNotConfiguredError(
      channel,
      error instanceof Error ? error.message : "provider construction failed"
    );
  }
}

/**
 * Returns the provider for a channel, constructing it once per process.
 *
 * Construction is cached but *failures are not* — a deployment that adds a
 * missing variable and restarts gets a working provider, and one that never
 * had it keeps getting the same clear error rather than a cached null.
 */
export function getOtpProvider(channel: OtpChannel): OtpProvider {
  if (channel === "EMAIL") {
    emailProvider ??= resolveProvider("EMAIL", buildEmailProvider);
    return emailProvider;
  }
  smsProvider ??= resolveProvider("SMS", buildSmsProvider);
  return smsProvider;
}

export { OtpProviderNotConfiguredError };
export type { OtpChannel, OtpProvider };
