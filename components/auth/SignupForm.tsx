"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { FormField } from "./FormField";
import { PasswordInput } from "./PasswordInput";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { Alert } from "@/components/ui/Alert";

type FieldErrors = Record<string, string>;

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    setLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password,
          confirmPassword,
          acceptedTerms,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        if (data.fieldErrors) setErrors(data.fieldErrors);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        Join PROPERTYNEX — find, invest, and belong.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
        {formError && <Alert>{formError}</Alert>}

        <FormField
          label="Full name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          required
        />

        <FormField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />

        <FormField
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          required
        />

        <div>
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            required
          />
          <PasswordStrengthMeter password={password} />
        </div>

        <PasswordInput
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={errors.confirmPassword}
          required
        />

        <div className="flex items-start gap-3 rounded-xl border border-cyan/20 bg-cyan/[0.06] px-4 py-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-slate-300">
            If you ever forget your password, we&apos;ll send a one-time passcode to the email
            address or mobile number above — so make sure both are ones you can access.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5 text-sm text-slate-400 transition-colors hover:text-slate-300">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-white/20 bg-white/5 text-royal accent-royal"
            required
          />
          <span>
            I agree to the Terms of Service and Privacy Policy.
            {errors.acceptedTerms && (
              <span className="mt-1 block text-xs font-medium text-red-400">
                {errors.acceptedTerms}
              </span>
            )}
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-primary w-full"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-cyan transition-colors hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
