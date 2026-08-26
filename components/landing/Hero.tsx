"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Compass,
  Handshake,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { EASE_PREMIUM } from "@/components/ui/Reveal";

/**
 * Landing hero.
 *
 * The section no longer paints its own full-bleed gradient or its own orb field:
 * `AmbientBackground` is fixed behind the whole page, and stacking a second
 * opaque gradient on top of it flattened the atmosphere and paid for two sets of
 * large blurs. What remains here is one local glow behind the headline, so the
 * hero reads brighter than the sections below it.
 *
 * Trust markers are deliberately qualitative. There are no user counts or
 * listing totals, because this milestone has no marketplace data to count.
 */

const TRUST_MARKERS = [
  { icon: ShieldCheck, label: "Verified listings" },
  { icon: Handshake, label: "Trusted agents" },
  { icon: Sparkles, label: "Smart discovery" },
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE_PREMIUM },
  },
};

export function Hero() {
  return (
    <section
      id="home"
      className="relative scroll-mt-24 overflow-hidden pb-20 pt-28 sm:pb-28 sm:pt-36 lg:pb-32 lg:pt-40"
    >
      {/* Local warm-up behind the copy — keeps the hero the brightest band on
          the page without a second full-page gradient. */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-[38rem]"
        style={{
          background:
            "radial-gradient(60% 55% at 30% 35%, rgba(37,99,235,0.22) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="shell relative grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 xl:gap-16">
        <motion.div initial="hidden" animate="visible" variants={container}>
          <motion.span variants={item} className="eyebrow">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-cyan animate-pulse-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-cyan" />
            </span>
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            Real Estate, Reimagined
          </motion.span>

          <motion.h1
            variants={item}
            className="mt-6 text-[2.5rem] font-extrabold leading-[1.08] tracking-tight text-white xs:text-5xl sm:text-6xl lg:text-[4.25rem]"
          >
            Find. Invest.{" "}
            <span className="gradient-text-animated">Belong.</span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg"
          >
            Your smarter way to discover, explore, and connect with real estate —
            one platform for buyers, tenants, owners, agents, and builders.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4"
          >
            <Link href="/buy" className="btn-primary group">
              Explore Properties
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
            <Link href="/signup" className="btn-secondary">
              Get Started
            </Link>
          </motion.div>

          {/* Qualitative trust row — no invented metrics. */}
          <motion.ul
            variants={item}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/[0.08] pt-6"
          >
            {TRUST_MARKERS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 text-sm text-slate-400"
              >
                <Icon className="h-4 w-4 shrink-0 text-cyan" aria-hidden="true" />
                {label}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_PREMIUM, delay: 0.15 }}
          className="relative mx-auto w-full max-w-lg lg:max-w-none"
        >
          {/* Gradient hairline frame. The 1px padding wrapper is what produces a
              true gradient border without `border-image` quirks. */}
          <div className="relative rounded-3xl bg-gradient-brand p-px shadow-glow-lg">
            <div className="relative overflow-hidden rounded-3xl bg-navy-950">
              <div className="relative aspect-[4/3] w-full">
                <Image
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1400&auto=format&fit=crop"
                  alt="Modern luxury home with clean architectural lines at dusk"
                  fill
                  sizes="(min-width: 1024px) 45vw, (min-width: 640px) 512px, 90vw"
                  className="object-cover"
                  priority
                />
                {/* Tint so the photo sits inside the palette instead of fighting it. */}
                <div
                  className="absolute inset-0 bg-gradient-to-tr from-navy-950/70 via-navy-950/10 to-transparent"
                  aria-hidden="true"
                />
                {/* Slow scan line — the one "AI" flourish on the page. */}
                <div
                  className="absolute inset-x-0 top-0 h-24 animate-scan bg-gradient-to-b from-transparent via-cyan/20 to-transparent"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          {/* Floating trust chip */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_PREMIUM, delay: 0.55 }}
            className="glass-card absolute -bottom-5 -left-3 w-52 p-4 animate-float-y-sm sm:-left-6 sm:w-60"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Built for
            </p>
            <p className="mt-1 text-lg font-bold leading-snug text-white sm:text-xl">
              Buyers, Agents <span className="text-cyan">&amp;</span> Builders
            </p>
          </motion.div>

          {/* Floating status chip */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_PREMIUM, delay: 0.7 }}
            className="glass-card absolute -right-2 -top-5 hidden items-center gap-2 px-3.5 py-2.5 animate-float-y sm:flex"
            style={{ animationDelay: "-2s" }}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-pulse-ring" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-semibold text-slate-200">
              Platform live
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
