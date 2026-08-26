import "server-only";
import { getOtpProvider } from "./providers";
import { OTP_TTL_MINUTES } from "./config";
import type { OtpChannel } from "./providers/types";

/**
 * Hands a passcode to the configured provider for the given channel.
 *
 * Split out from the session bookkeeping so that the two failure modes stay
 * distinguishable to callers: "this channel has no provider configured" is a
 * deployment fault that should look identical for every caller, whereas "the
 * provider rejected this one message" is transient and must not change what a
 * caller can infer about the account.
 */
export async function sendOtp(params: {
  channel: OtpChannel;
  destination: string;
  code: string;
}): Promise<void> {
  const provider = getOtpProvider(params.channel);
  await provider.send({
    channel: params.channel,
    destination: params.destination,
    code: params.code,
    expiresInMinutes: OTP_TTL_MINUTES,
  });
}

/**
 * Resolves the provider for a channel without sending anything, purely to
 * surface a configuration fault.
 *
 * The recovery endpoint calls this *before* it looks up the account, so a
 * missing provider produces the same error whether or not the identifier
 * belongs to a real user. Doing the check after the lookup would mean an
 * unconfigured deployment answered differently for real and unknown
 * identifiers — an enumeration oracle created by a config mistake.
 */
export function assertProviderConfigured(channel: OtpChannel): void {
  getOtpProvider(channel);
}
