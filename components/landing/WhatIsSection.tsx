"use client";

import { Building2, Users, Sparkles } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const PILLARS = [
  {
    icon: Building2,
    title: "One marketplace",
    body: "Buying, renting and selling in a single, consistent place.",
  },
  {
    icon: Users,
    title: "Everyone involved",
    body: "Buyers, tenants, owners, agents and builders, side by side.",
  },
  {
    icon: Sparkles,
    title: "Built to be modern",
    body: "Fast, clear and trustworthy from the first screen onward.",
  },
];

export function WhatIsSection() {
  return (
    <section id="about" className="section-y relative scroll-mt-24">
      <div className="shell">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="eyebrow">About the platform</span>
          <h2 className="section-heading mt-5">
            What is <span className="gradient-text">PROPERTYNEX</span>?
          </h2>
          <p className="section-sub mx-auto max-w-2xl text-slate-300">
            PROPERTYNEX is being developed as a unified platform for discovering,
            buying, renting, selling, and connecting with real-estate
            professionals — bringing buyers, tenants, owners, agents, and builders
            into one trusted, modern marketplace.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-3 sm:gap-6">
          {PILLARS.map((pillar, index) => (
            <Reveal key={pillar.title} delay={index * 0.08}>
              <div className="glass-card group relative h-full overflow-hidden p-6 card-interactive">
                <div className="card-spotlight" aria-hidden="true" />
                <div className="relative">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] transition-transform duration-300 ease-spring group-hover:scale-110">
                    <pillar.icon
                      className="h-5 w-5 text-cyan"
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-white">
                    {pillar.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                    {pillar.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
