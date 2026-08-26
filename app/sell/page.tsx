import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ClipboardList,
  EyeOff,
  Hammer,
  Inbox,
  LayoutDashboard,
  PhoneOff,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "Sell Your Property — PROPERTYNEX",
  description:
    "List your property on PROPERTYNEX. Publish when you're ready, control how buyers reach you, and keep your exact address private.",
};

/**
 * `/sell` — the owner's side of the marketplace.
 *
 * ── Where the CTAs go ───────────────────────────────────────────────────────
 *
 * Straight to `/dashboard/properties/new`, which is a real screen now. A
 * signed-out visitor clicking it is redirected to `/login?redirectTo=…` and
 * lands back on the form after signing in, so the funnel is one link rather than
 * "make an account, then go and find the form".
 *
 * Everything the "What you control" section claims is already true of the data
 * model and the public read path, not aspirational:
 *
 *   - draft / publish / unpublish are real `PropertyStatus` values, and
 *     unpublishing keeps the row (see `STATUS_DESCRIPTIONS`).
 *   - verification is a real state transition, admin-granted, and `/buy` and
 *     `/rent` render the badge for it.
 *   - `ContactPreference.IN_APP` is honoured by construction: `PublicListing`
 *     carries no contact field at all.
 *   - the exact address genuinely does not reach a browse page — the public
 *     projection drops `addressLine1/2`, `pincode` and the coordinates.
 *
 * The status panel near the bottom says plainly which part is still missing —
 * now the buyer's side of an inquiry, not the owner's form. A page that sold a
 * flow the app cannot yet deliver would be the one dishonest thing on it.
 */

const STEPS = [
  {
    icon: UserPlus,
    title: "Create your account",
    body: "One account for everything you list. Your name, email and phone number are all it needs.",
  },
  {
    icon: ClipboardList,
    title: "Describe the property",
    body: "Type, price, area, configuration, floor, furnishing, parking, amenities and location — as much detail as buyers actually ask for.",
  },
  {
    icon: Send,
    title: "Publish when you're ready",
    body: "Save it as a draft as long as you like. Nothing is visible to anyone else until you choose to publish it.",
  },
  {
    icon: Inbox,
    title: "Hear from real buyers",
    body: "Inquiries arrive against the listing they're about, so you always know which property someone means.",
  },
] as const;

const CONTROLS = [
  {
    icon: EyeOff,
    title: "Draft first, publish later",
    body: "A draft is yours alone. Publish it, take it offline again, republish it — the listing and its details survive every one of those.",
  },
  {
    icon: PhoneOff,
    title: "Your number, your rules",
    body: "Choose whether buyers can call, email, either — or reach you only through PROPERTYNEX. Pick the last one and your phone and email never appear on the listing.",
  },
  {
    icon: ShieldCheck,
    title: "Your address stays private",
    body: "Public listings show the locality, city and state. The street address, pincode and map pin are never published to visitors.",
  },
  {
    icon: BadgeCheck,
    title: "Get the verified badge",
    body: "Submit a published listing for review. Once PROPERTYNEX approves it, it carries a verified badge everywhere it appears.",
  },
  {
    icon: LayoutDashboard,
    title: "One place for all of it",
    body: "Every property you list, its status and its inquiries live in your dashboard — not in a thread of emails.",
  },
  {
    icon: Building2,
    title: "Homes, shops, land",
    body: "Fourteen property types across residential, commercial and land, each asking for the details that actually apply to it.",
  },
] as const;

export default function SellPage() {
  return (
    <PageShell>
      {/* Hero */}
      <section className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-[34rem]"
          style={{
            background:
              "radial-gradient(55% 60% at 35% 40%, rgba(124,58,237,0.20) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="shell relative">
          <Reveal className="max-w-3xl">
            <span className="eyebrow">
              <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
              For owners &amp; agents
            </span>
            <h1 className="mt-6 text-[2.25rem] font-extrabold leading-[1.1] tracking-tight text-white xs:text-5xl lg:text-[3.5rem]">
              Sell your property,{" "}
              <span className="gradient-text">on your terms</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              List what you own, decide exactly how buyers reach you, and keep the
              details you&apos;d rather not publish off the page. No cold calls you
              didn&apos;t ask for.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4">
              <Link href="/dashboard/properties/new" className="btn-primary group">
                List your property
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
              <Link href="/signup" className="btn-secondary">
                Create your account
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section className="relative pb-4">
        <div className="shell">
          <Reveal className="max-w-2xl">
            <span className="eyebrow">How it works</span>
            <h2 className="section-heading mt-5">
              Four steps, <span className="gradient-text">start to inquiry</span>
            </h2>
          </Reveal>

          <ol className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 0.07} className="h-full">
                  <div className="glass-card group relative h-full overflow-hidden p-6">
                    <div className="card-spotlight" aria-hidden="true" />

                    {/* Ghosted step number, matching FeatureCards. */}
                    <span
                      className="pointer-events-none absolute right-4 top-3 text-5xl font-extrabold text-white/[0.04] tabular"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div className="relative">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-b shadow-glow">
                        <step.icon className="h-5 w-5 text-white" aria-hidden="true" />
                      </div>
                      <h3 className="mt-5 text-lg font-semibold text-white">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">
                        {step.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* What you control */}
      <section className="section-y relative">
        <div
          className="pointer-events-none absolute inset-x-0 top-1/4 h-96"
          style={{
            background:
              "radial-gradient(50% 60% at 50% 50%, rgba(6,182,212,0.09) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="shell relative">
          <Reveal className="max-w-2xl">
            <span className="eyebrow">What you control</span>
            <h2 className="section-heading mt-5">
              Your listing, <span className="gradient-text">your decisions</span>
            </h2>
            <p className="section-sub">
              Privacy and visibility are settings on the listing, not favours you
              have to ask for.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {CONTROLS.map((control, index) => (
              <Reveal key={control.title} delay={(index % 3) * 0.07} className="h-full">
                <div className="glass-card group relative h-full overflow-hidden p-6">
                  <div className="card-spotlight" aria-hidden="true" />
                  <div className="relative">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                      <control.icon className="h-5 w-5 text-cyan" aria-hidden="true" />
                    </div>
                    <h3 className="mt-5 text-base font-semibold text-white">
                      {control.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                      {control.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Where the build actually is. */}
      <section className="relative pb-8">
        <div className="shell">
          <Reveal>
            <div className="glass-card edge-glow relative overflow-hidden p-6 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
                  <ClipboardList className="h-5 w-5 text-amber-300" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Where we are right now
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                    Accounts, sign-in, your profile and the listing form itself are all live
                    today — you can{" "}
                    <Link
                      href="/dashboard/properties/new"
                      className="font-medium text-cyan hover:underline"
                    >
                      add a property
                    </Link>
                    , upload its photos, and publish it to the{" "}
                    <Link href="/buy" className="font-medium text-cyan hover:underline">
                      Buy
                    </Link>{" "}
                    and{" "}
                    <Link href="/rent" className="font-medium text-cyan hover:underline">
                      Rent
                    </Link>{" "}
                    pages. What is still being built is the buyer&apos;s half of the
                    conversation: the individual listing page and the inquiry form on it. Until
                    that lands, your listings are visible and browsable, but nobody can send you
                    an inquiry through the site yet.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Closing CTA — same gradient-hairline panel as the landing page. */}
      <section className="relative py-16 sm:py-24">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-brand p-px shadow-glow-lg">
              <div className="relative overflow-hidden rounded-3xl bg-navy-950 px-6 py-14 text-center sm:px-12 sm:py-16">
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(70% 90% at 50% 0%, rgba(124,58,237,0.26) 0%, transparent 65%)",
                  }}
                  aria-hidden="true"
                />
                <div className="relative mx-auto max-w-2xl">
                  <h2 className="text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">
                    Ready when you are.
                  </h2>
                  <p className="mt-4 text-base text-slate-300">
                    Create your account today, and see what buyers are already
                    browsing.
                  </p>
                  <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
                    <Link href="/signup" className="btn-primary group px-8">
                      Get started
                      <ArrowRight
                        className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </Link>
                    <Link href="/buy" className="btn-secondary px-8">
                      Browse listings
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </PageShell>
  );
}
