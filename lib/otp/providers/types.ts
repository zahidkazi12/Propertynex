/**
 * The delivery-provider seam.
 *
 * Nothing in the recovery flow knows how a passcode reaches a person. It hands
 * an `OtpMessage` to whatever `OtpProvider` the environment selects, and cares
 * only whether delivery was accepted. That keeps provider credentials out of
 * the flow entirely and makes "we switched from Resend to SES" a change to one
 * file in this directory.
 */

export type OtpChannel = "EMAIL" | "SMS";

export interface OtpMessage {
  channel: OtpChannel;
  /** Full, unmasked address or phone number. Never logged by a provider. */
  destination: string;
  /** The plaintext passcode. Never persisted and never logged in production. */
  code: string;
  /** For message copy: "expires in N minutes". */
  expiresInMinutes: number;
}

export interface OtpProvider {
  /** Short identifier used in server-side diagnostics — never user-facing. */
  readonly name: string;
  /**
   * Delivers the passcode, or throws. Throwing is meaningful: the caller
   * discards the recovery session rather than leaving the user with a session
   * whose code never arrived.
   */
  send(message: OtpMessage): Promise<void>;
}

/**
 * Thrown when no provider is configured for a channel, or its configuration is
 * incomplete. Callers translate this into a generic user-facing error — the
 * client is never told which provider or which variable is missing.
 */
export class OtpProviderNotConfiguredError extends Error {
  constructor(channel: OtpChannel, detail: string) {
    super(`No usable OTP provider for channel ${channel}: ${detail}`);
    this.name = "OtpProviderNotConfiguredError";
  }
}

/** Thrown when a configured provider was reached but refused the message. */
export class OtpDeliveryError extends Error {
  constructor(providerName: string, detail: string) {
    super(`Provider ${providerName} failed to deliver: ${detail}`);
    this.name = "OtpDeliveryError";
  }
}
