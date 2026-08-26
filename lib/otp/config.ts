/**
 * Every tunable in the OTP password-recovery flow, in one place.
 *
 * These are deliberately module constants rather than environment variables:
 * they are security policy, not deployment configuration, and a misconfigured
 * env var silently widening the brute-force window would be worse than a
 * redeploy. The OTP *provider* is configured by environment (see
 * lib/otp/providers) — the policy below is not.
 */

/** Digits in a passcode. 6 digits = 1,000,000 possibilities. */
export const OTP_LENGTH = 6;

/** How long a freshly issued passcode stays valid. */
export const OTP_TTL_MS = 1000 * 60 * 10; // 10 minutes

/**
 * How long the caller has to actually set a new password after the passcode
 * has been verified. Short, because at this point the token in the client's
 * hands is equivalent to proof of identity.
 */
export const RESET_WINDOW_MS = 1000 * 60 * 10; // 10 minutes

/** Minimum gap between "send me another code" requests for one session. */
export const RESEND_COOLDOWN_MS = 1000 * 60; // 60 seconds

/**
 * Maximum passcodes issued per recovery session (1 initial + this many
 * resends). Combined with MAX_OTP_ATTEMPTS this caps a session at
 * (MAX_RESENDS + 1) * MAX_OTP_ATTEMPTS = 20 guesses against a 1-in-10^6 space.
 */
export const MAX_RESENDS = 3;

/** Failed verification attempts allowed against a single passcode. */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * Floor on how long the "request a passcode" endpoint takes to respond.
 *
 * The real path does a user lookup plus a network call to the delivery
 * provider; the decoy path (no such account) does neither. Without a floor,
 * that difference in response time is itself an account-existence oracle, no
 * matter how carefully the response bodies are made identical. Every response
 * from that endpoint — success, decoy, or provider failure — is padded to at
 * least this long. See lib/utils/timing.ts.
 */
export const START_RESPONSE_FLOOR_MS = 700;

/** Convenience for user-facing copy ("expires in 10 minutes"). */
export const OTP_TTL_MINUTES = Math.round(OTP_TTL_MS / 60000);
export const RESEND_COOLDOWN_SECONDS = Math.round(RESEND_COOLDOWN_MS / 1000);
