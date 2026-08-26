"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Key, Tag } from "lucide-react";
import { Reveal, EASE_PREMIUM } from "@/components/ui/Reveal";

/**
 * The three things a visitor comes here to do, directly under the hero.
 *
 * This is the homepage's main routing decision, so it is a band of its own
 * rather than three links in a row: the hero states what PROPERTYNEX is, and
 * this answers "so what do I do now" before the explanatory sections below.
 *
 * It is not a second `FeatureCards`. That grid is a survey of the platform,
 * including parts still being built; these three are working destinations, and
 * the whole card surface is the link — a large tap target rather than a small
 * "learn more" at the bottom.
 *
 * Accent classes are written out per entry instead of composed from a token.
 * Tailwind scans source text for class names, so a template-built
 * `text-${accent}` would be absent from the stylesheet at build time.
 */
const INTENTS = [
  {
    href: "/buy",
    icon: Building2,
    eyebrow: "For buyers",
    title: "Buy a property",
    desc: "Browse live listings for sale and filter by city, budget, type and configuration.",
    cta: "Browse properties for sale",
    iconClass: "bg-gradient-b shadow-glow group-hover:shadow-glow-cyan",
    hoverText: "group-hover:text-cyan",
    glow: "rgba(6,182,212,0.16)",
  },
  {
    href: "/sell",
    icon: Tag,
    eyebrow: "For owners",
    title: "Sell your property",
    desc: "List what you own, keep control of how buyers reach you, and manage it all from one dashboard.",
    cta: "See how selling works",
    iconClass: "bg-gradient-brand shadow-glow group-hover:shadow-glow-violet",
    hoverText: "group-hover:text-violet-300",
    glow: "rgba(124,58,237,0.16)",
  },
  {
    href: "/rent",
    icon: Key,
    eyebrow: "For tenants",
    title: "Rent a home",
    desc: "Find places available to rent, with the monthly price, furnishing and locality up front.",
    cta: "Browse rentals",
    iconClass: "bg-gradient-b shadow-glow group-hover:shadow-glow-cyan",
    hoverText: "group-hover:text-cyan",
    glow: "rgba(37,99,235,0.16)",
  },
] as const;

export function IntentActions() {
  return (
    <section id="start" className="relative scroll-mt-24 pb-4 pt-2 sm:pb-8">
      <div className="shell relative">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Get moving</span>
          <h2 className="section-heading mt-5">
            What brings you <span className="gradient-text">here</span>?
          </h2>
          <p className="section-sub">
            Three ways in. Pick the one that fits and start from there.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:gap-6 lg:grid-cols-3">
          {INTENTS.map((intent, index) => (
            <motion.div
              key={intent.href}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: EASE_PREMIUM }}
            >
              <Link
                href={intent.href}
                className="glass-card card-interactive edge-glow group relative flex h-full flex-col overflow-hidden p-7 sm:p-8"
              >
                <div className="card-spotlight" aria-hidden="true" />

                {/* Per-card pool of light, tinted to that intent's accent. */}
                <div
                  className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                  style={{ background: intent.glow }}
                  aria-hidden="true"
                />

                <div className="relative flex flex-1 flex-col">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300 ease-spring group-hover:scale-110 group-hover:rotate-3 ${intent.iconClass}`}
                  >
                    <intent.icon className="h-6 w-6 text-white" aria-hidden="true" />
                  </div>

                  <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {intent.eyebrow}
                  </p>
                  <h3
                    className={`mt-1.5 text-xl font-bold tracking-tight text-white transition-colors duration-300 sm:text-2xl ${intent.hoverText}`}
                  >
                    {intent.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">
                    {intent.desc}
                  </p>

                  {/* Pinned to the bottom so the three CTAs align even when the
                      descriptions wrap to different heights. */}
                  <span className="mt-auto flex items-center gap-2 pt-7 text-sm font-semibold text-white">
                    {intent.cta}
                    <ArrowRight
                      className="h-4 w-4 text-cyan transition-transform duration-300 ease-premium group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
