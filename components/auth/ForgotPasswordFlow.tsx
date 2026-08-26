"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  ShieldCheck,
  TimerOff,
} from "lucide-react";
import { FormField } from "./FormField";
import { PasswordInput } from "./PasswordInput";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { OtpInput } from "./OtpInput";
import { ResendControl } from "./ResendControl";
import { Alert } from "@/components/ui/Alert";
import { cn } from "@/lib/utils/cn";

type Step = "identify" | "verify" | "reset" | "done";

const STEP_ORDER: Step[] = ["identify", "verify", "reset", "done"];
const STEP_LABELS: Record<Step, string> = {
  identify: "Account",
  verify: "Verify",
  reset: "Password",
  done: "Done",
};

const OTP_LENGTH = 6;

interface StartResponse {
  recoveryToken: string;
  channel: "EMAIL" | "SMS";
  destination: string;
  codeLength: number;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  resendsRemaining: number;
  maxAttempts: number;
}

/**
 * Forgot Password — OTP flow.
 *
 * Identify (email or mobile) -> verify a passcode -> set a new password -> done.
 *
 * Two things about this component are load-bearing rather than cosmetic:
 *
 *  - It never learns whether the account exists. Step 1 always advances to the
 *    passcode screen, because the API answers identically either way. There is
 *    deliberately no "we couldn't find that account" branch to write.
 *
 *  - It treats the server as the only authority. The cooldown, the attempt
 *    budget and the expiry shown here are echoes of what the API returned; all
 *    three are enforced server-side, so the countdowns are courtesy rather than
 *    protection. When the server says a session is finished
 *    (`fieldErrors.form === "EXPIRED_SESSION"`), the flow resets to step 1
 *    instead of leaving the user poking at a dead token.
 */
export function ForgotPasswordFlow() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("identify");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Step 1
  const [identifier, setIdentifier] = useState("");

  // Step 2
  const [recoveryToken, setRecoveryToken] = useState("");
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [destination, setDestination] = useState("");
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [codeExpiresAt, setCodeExpiresAt] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendsRemaining, setResendsRemaining] = useState(0);

  // Step 3
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const codeSecondsLeft = useCountdown(codeExpiresAt);
  const codeExpired = codeExpiresAt > 0 && codeSecondsLeft === 0;

  function resetToStart(message: string) {
    setStep("identify");
    setRecoveryToken("");
    setResetToken("");
    setCode("");
    setCodeInvalid(false);
    setCodeExpiresAt(0);
    setResendAvailableAt(0);
    setFormError(message);
  }

  /** Applies a failed response, bouncing to step 1 if the session is done. */
  function applyError(data: { error?: string; fieldErrors?: Record<string, string> }, fallback: string) {
    if (data.fieldErrors?.form === "EXPIRED_SESSION") {
      resetToStart(data.error ?? fallback);
      return;
    }
    setFormError(data.error ?? fallback);
    setFieldErrors(data.fieldErrors ?? {});
  }

  async function handleIdentifySubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await response.json();

      if (!response.ok) {
        applyError(data, "Something went wrong. Please try again.");
        return;
      }

      const start = data as StartResponse;
      setRecoveryToken(start.recoveryToken);
      setChannel(start.channel);
      setDestination(start.destination);
      setCodeExpiresAt(Date.now() + start.expiresInSeconds * 1000);
      setResendAvailableAt(Date.now() + start.resendAfterSeconds * 1000);
      setResendsRemaining(start.resendsRemaining);
      setCode("");
      setCodeInvalid(false);
      setStep("verify");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Verifies a passcode. Takes the code as an argument rather than reading it
   * from state because the auto-submit path fires from inside the same update
   * that completed the field, where the state value would still be one digit
   * behind.
   */
  const verifyCode = useCallback(
    async (submitted: string) => {
      setFormError(null);
      setFieldErrors({});
      setCodeInvalid(false);
      setSubmitting(true);
      try {
        const response = await fetch("/api/auth/forgot-password/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recoveryToken, code: submitted }),
        });
        const data = await response.json();

        if (!response.ok) {
          if (data.fieldErrors?.form === "EXPIRED_SESSION") {
            resetToStart(data.error ?? "This reset request is no longer valid. Please start again.");
            return;
          }
          setCodeInvalid(true);
          setCode("");
          setFormError(data.error ?? "That code is not correct.");
          if (data.fieldErrors?.code === "EXPIRED_CODE") setCodeExpiresAt(Date.now());
          return;
        }

        setResetToken(data.resetToken);
        setStep("reset");
      } catch {
        setFormError("Network error. Please check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [recoveryToken]
  );

  async function handleResend() {
    setFormError(null);
    setFieldErrors({});
    setResending(true);
    try {
      const response = await fetch("/api/auth/forgot-password/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryToken }),
      });
      const data = await response.json();

      if (!response.ok) {
        applyError(data, "Could not send a new code. Please try again.");
        return;
      }

      setCode("");
      setCodeInvalid(false);
      setCodeExpiresAt(Date.now() + data.expiresInSeconds * 1000);
      setResendAvailableAt(Date.now() + data.resendAfterSeconds * 1000);
      setResendsRemaining(data.resendsRemaining);
      setFormError(null);
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  async function handleResetSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        applyError(data, "Something went wrong. Please try again.");
        return;
      }

      setStep("done");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const ChannelIcon = channel === "EMAIL" ? Mail : MessageSquare;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]">
        Reset your password
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        We&apos;ll send a one-time passcode to the email or mobile number on your account.
      </p>

      <ol className="mt-7 flex items-center gap-2" aria-label="Progress">
        {STEP_ORDER.map((s, i) => {
          const currentIndex = STEP_ORDER.indexOf(step);
          const isActive = i <= currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <li key={s} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-500 ease-premium",
                  isActive
                    ? "bg-gradient-b text-white"
                    : "bg-white/[0.07] text-slate-500",
                  isCurrent && "ring-2 ring-cyan/40 ring-offset-2 ring-offset-navy-950"
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {i < currentIndex ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "hidden text-xs font-medium transition-colors duration-300 xs:block",
                  isActive ? "text-slate-200" : "text-slate-500"
                )}
              >
                {STEP_LABELS[s]}
              </span>
              {i < STEP_ORDER.length - 1 && (
                <div className="h-px flex-1 overflow-hidden bg-white/10">
                  <div
                    className={cn(
                      "h-full w-full origin-left bg-gradient-b transition-transform duration-500 ease-premium",
                      i < currentIndex ? "scale-x-100" : "scale-x-0"
                    )}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-7">
        {formError && <Alert>{formError}</Alert>}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {step === "identify" && (
              <form onSubmit={handleIdentifySubmit} className="space-y-5" noValidate>
                <FormField
                  label="Email or mobile number"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="you@example.com or +91 98765 43210"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  error={fieldErrors.identifier}
                  hint="We'll send your passcode to whichever you use here."
                  required
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className="btn-primary w-full"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {submitting ? "Sending code…" : "Send passcode"}
                </button>
              </form>
            )}

            {step === "verify" && (
              <div className="space-y-5">
                <div className="glass-panel flex items-start gap-3 rounded-xl p-4">
                  <ChannelIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {channel === "EMAIL" ? "Passcode sent by email" : "Passcode sent by SMS"}
                    </p>
                    <p className="mt-1 break-all text-sm font-medium text-slate-100">
                      {destination}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      If an account exists for this {channel === "EMAIL" ? "address" : "number"},
                      a {OTP_LENGTH}-digit code is on its way.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.length === OTP_LENGTH) void verifyCode(code);
                  }}
                  className="space-y-5"
                  noValidate
                >
                  <div>
                    <span className="field-label" id="otp-label">
                      Enter the {OTP_LENGTH}-digit passcode
                    </span>
                    <OtpInput
                      value={code}
                      onChange={(next) => {
                        setCode(next);
                        if (codeInvalid) setCodeInvalid(false);
                      }}
                      onComplete={(complete) => {
                        if (!submitting && !codeExpired) void verifyCode(complete);
                      }}
                      length={OTP_LENGTH}
                      disabled={submitting || codeExpired}
                      invalid={codeInvalid}
                      describedBy="otp-status"
                      autoFocus
                    />
                    <p
                      id="otp-status"
                      className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"
                      aria-live="polite"
                    >
                      {codeExpired ? (
                        <>
                          <TimerOff className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                          <span className="text-amber-400">
                            This code has expired — request a new one.
                          </span>
                        </>
                      ) : (
                        <>Code expires in {formatCountdown(codeSecondsLeft)}</>
                      )}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || code.length !== OTP_LENGTH || codeExpired}
                    aria-busy={submitting}
                    className="btn-primary w-full"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {submitting ? "Verifying…" : "Verify passcode"}
                  </button>
                </form>

                <ResendControl
                  availableAt={resendAvailableAt}
                  onResend={() => void handleResend()}
                  sending={resending}
                  remaining={resendsRemaining}
                  disabled={submitting}
                />

                <button
                  type="button"
                  onClick={() => resetToStart("")}
                  className="mx-auto flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Use a different email or number
                </button>
              </div>
            )}

            {step === "reset" && (
              <form onSubmit={handleResetSubmit} className="space-y-5" noValidate>
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Passcode verified. Choose a new password to finish.</span>
                </div>

                <div>
                  <PasswordInput
                    label="New password"
                    name="newPassword"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    error={fieldErrors.newPassword}
                    required
                    autoFocus
                  />
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <PasswordInput
                  label="Confirm new password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  error={fieldErrors.confirmPassword}
                  required
                />

                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className="btn-primary w-full"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {submitting ? "Resetting…" : "Reset password"}
                </button>
              </form>
            )}

            {step === "done" && (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
                  <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">Password updated</h2>
                <p className="mt-1.5 text-sm text-slate-400">
                  You&apos;ve been logged out of all devices for security. Log in with your new
                  password.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="btn-primary mt-6 w-full"
                >
                  Go to login
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {step !== "done" && (
        <p className="mt-6 text-center text-sm text-slate-400">
          Remembered your password?{" "}
          <Link href="/login" className="font-semibold text-cyan hover:underline">
            Log in
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * Seconds remaining until an absolute deadline.
 *
 * The value is *derived* from the deadline and the current clock on every
 * render; the interval exists only to force those renders. That is what keeps it
 * honest across a throttled background tab or a sleeping device — there is no
 * stored counter to fall behind, so returning to the tab shows the true
 * remaining time rather than resuming from wherever the timer stalled.
 */
function useCountdown(deadline: number): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (deadline === 0) return;

    const id = setInterval(() => {
      setTick((tick) => tick + 1);
      if (deadline - Date.now() <= 0) clearInterval(id);
    }, 500); // Twice a second, so the displayed value never lags by ~1s.

    return () => clearInterval(id);
  }, [deadline]);

  return toSeconds(deadline);
}

function toSeconds(deadline: number): number {
  if (deadline === 0) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function formatCountdown(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
