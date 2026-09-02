"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { FormField } from "@/components/auth/FormField";
import { TextAreaField } from "@/components/ui/TextAreaField";
import { Alert } from "@/components/ui/Alert";
import { MAX_INQUIRY_MESSAGE_LENGTH } from "@/lib/validation/inquiry";

/**
 * The "contact the seller" form on `/property/[id]`.
 *
 * ── Why it is offered even when a phone number is shown ─────────────────────
 *
 * `contactPreference` decides whether the seller's phone or email appears beside
 * this form (`toPublicSellerContact` in `lib/properties/public.ts` is the only
 * place that can disclose either). It does **not** decide whether this form
 * appears: `IN_APP` means "do not surface my number", not "do not contact me",
 * and it is the case the form exists for. A seller who chose `IN_APP` and got no
 * way to be reached would simply be unreachable.
 *
 * ── Why name and email are asked for even when signed in ────────────────────
 *
 * They prefill from the session, but what is typed is what is sent —
 * `lib/validation/inquiry.ts` explains why (the person typing is not always the
 * person on the account). `fromUserId` records which account it came through and
 * is read from the cookie server-side; there is deliberately no field for it here.
 *
 * ── The three responses this has to tell apart ──────────────────────────────
 *
 * The route answers 201, 400 with `fieldErrors`, or 429 — and the 429 comes in two
 * flavours that mean different things to the sender ("you have sent a lot of
 * enquiries" vs "you have already contacted this seller"). All of them are
 * surfaced with the server's own wording rather than a generic failure, because
 * "already contacted, they will be in touch" is reassurance and "try again in 12
 * minutes" is an instruction, and a single "something went wrong" would lose both.
 */

export function InquiryForm({
  propertyId,
  defaultName = "",
  defaultEmail = "",
  defaultPhone = "",
}: {
  propertyId: string;
  /** Prefills from the session, when there is one. Resolved on the server. */
  defaultName?: string;
  defaultEmail?: string;
  defaultPhone?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    setLoading(true);

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, name, email, phone, message }),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        if (data.fieldErrors) setErrors(data.fieldErrors);
        return;
      }

      setSent(true);
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Replaces the form rather than sitting above it: the message is gone, there is
  // no draft left to edit, and a second identical send is what the per-property
  // rate limit exists to refuse anyway.
  if (sent) {
    return (
      <div className="glass-card edge-glow relative overflow-hidden p-6 text-center sm:p-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, rgba(16,185,129,0.16) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-300" aria-hidden="true" />
          </div>
          <h3 className="mt-5 text-lg font-bold tracking-tight text-white">
            Your enquiry has been sent
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The seller has it, along with the contact details you gave. They will
            reach out to you directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card space-y-5 p-5 sm:p-6" noValidate>
      <div>
        <h3 className="text-lg font-bold tracking-tight text-white">Contact the seller</h3>
        <p className="mt-1.5 text-sm text-slate-400">
          Send a message about this listing. You do not need an account.
        </p>
      </div>

      {formError && <Alert>{formError}</Alert>}

      <FormField
        label="Your name"
        name="name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        required
      />

      <FormField
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
        hint="How the seller will reply to you."
        required
      />

      <FormField
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="Optional"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        error={errors.phone}
        hint="Optional — add it if you would rather be called."
      />

      <TextAreaField
        label="Message"
        name="message"
        rows={5}
        maxLength={MAX_INQUIRY_MESSAGE_LENGTH}
        showCount
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        error={errors.message}
        hint="What would you like to know? A sentence or two is enough."
        required
      />

      <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary w-full">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" aria-hidden="true" />
        )}
        {loading ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  );
}
