import Link from "next/link";
import { Facebook, Instagram, Linkedin, Twitter } from "lucide-react";
import { Logo } from "./Logo";

/**
 * Mirrors the navbar. Buy / Rent / Sell previously all pointed at `/#features` —
 * three labels, one anchor — and now point at their own pages. "Explore" is
 * dropped for the same reason it left the navbar: `/buy` and `/rent` are the
 * browse experience it stood in for.
 */
const NAV_COLUMN = [
  { label: "Home", href: "/" },
  { label: "Buy", href: "/buy" },
  { label: "Sell", href: "/sell" },
  { label: "Rent", href: "/rent" },
  { label: "About", href: "/#about" },
];

const ACCOUNT_COLUMN = [
  { label: "Login", href: "/login" },
  { label: "Signup", href: "/signup" },
];

/**
 * "Property Listings" is gone from this list: browsing live listings is what
 * `/buy` and `/rent` now do. What is genuinely still missing is the page a
 * single listing gets — hence the narrower first entry.
 */
const COMING_SOON = ["Listing Detail Pages", "Agent Directory", "Map Search", "Messaging"];

/**
 * Social handles are rendered as non-interactive marks, not links: PROPERTYNEX
 * has no published profiles yet, and inventing hrefs would ship four dead
 * outbound links. They carry a "coming soon" accessible name instead.
 */
const SOCIALS = [
  { icon: Facebook, label: "Facebook" },
  { icon: Instagram, label: "Instagram" },
  { icon: Twitter, label: "Twitter" },
  { icon: Linkedin, label: "LinkedIn" },
];

export function Footer() {
  return (
    <footer className="relative mt-8 border-t border-white/10 bg-navy-950/70 backdrop-blur-xl">
      {/* Brand hairline along the very top edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(6,182,212,0.4), rgba(124,58,237,0.3), transparent)",
        }}
        aria-hidden="true"
      />

      <div className="shell py-14 lg:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo />
            <p className="mt-4 text-sm font-semibold text-cyan">
              Find. Invest. Belong.
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
              A modern platform for discovering, buying, renting, selling, and
              connecting with real-estate professionals.
            </p>
            <div className="mt-6 flex gap-2.5">
              {SOCIALS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-500 transition-all duration-300 ease-premium hover:-translate-y-0.5 hover:border-cyan/30 hover:text-cyan"
                  title={`${label} (coming soon)`}
                  aria-label={`${label} — coming soon`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              ))}
            </div>
          </div>

          <nav aria-label="Site">
            <h3 className="text-sm font-semibold text-white">Navigate</h3>
            <ul className="mt-4 space-y-1">
              {NAV_COLUMN.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="group inline-flex items-center gap-1.5 py-1.5 text-sm text-slate-400 transition-colors duration-200 hover:text-cyan"
                  >
                    <span
                      className="h-px w-0 bg-cyan transition-all duration-300 ease-premium group-hover:w-3"
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account">
            <h3 className="text-sm font-semibold text-white">Account</h3>
            <ul className="mt-4 space-y-1">
              {ACCOUNT_COLUMN.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="group inline-flex items-center gap-1.5 py-1.5 text-sm text-slate-400 transition-colors duration-200 hover:text-cyan"
                  >
                    <span
                      className="h-px w-0 bg-cyan transition-all duration-300 ease-premium group-hover:w-3"
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="text-sm font-semibold text-white">Coming Soon</h3>
            <ul className="mt-4 space-y-2.5">
              {COMING_SOON.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm text-slate-500"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet/60"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="divider-glow my-10" />

        <div className="flex flex-col items-center gap-3 text-center text-sm text-slate-500 lg:flex-row lg:justify-between lg:gap-6 lg:text-left">
          <p>Developed by Zahid Kazi & Team</p>
          <p className="font-medium text-slate-400">PROPERTYNEX © 2026</p>
          <p>Copyright © 2026 PROPERTYNEX. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
