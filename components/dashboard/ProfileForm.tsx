"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, KeyRound } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { Alert } from "@/components/ui/Alert";
import type { SafeUser } from "@/types";

export function ProfileForm({ user }: { user: SafeUser }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [image, setImage] = useState(user.image ?? "");
  const [imageFailed, setImageFailed] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccess(false);
    setErrors({});
    setLoading(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, image }),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        if (data.fieldErrors) setErrors(data.fieldErrors);
        return;
      }

      setSuccess(true);
      router.refresh();
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr] lg:gap-6">
      <div className="glass-card relative flex flex-col items-center gap-4 overflow-hidden p-6 text-center">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-royal/20 blur-[60px]"
          aria-hidden="true"
        />
        {/* Gradient ring around the avatar. */}
        <div className="relative rounded-full bg-gradient-brand p-[2px] shadow-glow">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-navy-900 text-2xl font-bold text-white">
            {image && !imageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="h-full w-full rounded-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              initials
            )}
          </div>
        </div>
        <div className="relative min-w-0">
          <p className="truncate font-semibold text-white">{user.name}</p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{user.email}</span>
          </p>
        </div>
        <div className="relative flex items-center gap-1.5 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan">
          <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Passcode recovery enabled
        </div>
      </div>

      <form onSubmit={handleSubmit} className="glass-card space-y-5 p-5 sm:p-6" noValidate>
        {formError && <Alert>{formError}</Alert>}
        {success && <Alert tone="success">Your profile has been updated.</Alert>}

        <FormField
          label="Full name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          required
        />

        <FormField label="Email address" name="email" value={user.email} disabled hint="Email cannot be changed here." />

        <FormField
          label="Phone number"
          name="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          hint="Also used to send you a passcode if you need to reset your password."
          required
        />

        <FormField
          label="Profile photo URL"
          name="image"
          type="url"
          placeholder="https://…"
          value={image}
          onChange={(e) => {
            setImage(e.target.value);
            setImageFailed(false);
          }}
          error={errors.image}
          hint="Paste a link to an image. File uploads are coming in a future update."
        />

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-primary w-full sm:w-auto"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
