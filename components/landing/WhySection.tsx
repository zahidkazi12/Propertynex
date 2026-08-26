"use client";

import { ShieldCheck, Sparkles, Waves, Handshake } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const REASONS = [
  {
    icon: ShieldCheck,
    label: "Verified Listings",
    body: "Details you can act on, not guess at.",
  },
  {
    icon: Sparkles,
    label: "Smart Discovery",
    body: "Surfacing the places that actually fit.",
  },
  {
    icon: Waves,
    label: "Seamless Experience",
    body: "One flow from first search to first message.",
  },
  {
    icon: Handshake,
    label: "Trusted Connections",
    body: "Real professionals, clearly identified.",
  },
];

export function WhySection() {
  return (
    <section className="section-y relative">
      <div className="shell">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">The difference</span>
          <h2 className="section-heading mt-5">
            Why <span className="gradient-text">PROPERTYNEX</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 xs:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {REASONS.map((reason, index) => (
            <Reveal key={reason.label} delay={index * 0.08}>
              <div className="glass-card group relative h-full overflow-hidden p-6 text-center card-interactive">
                <div className="card-spotlight" aria-hidden="true" />
                <div className="relative flex flex-col items-center gap-3">
                  {/* Concentric ring that brightens on hover. */}
                  <span className="relative flex h-14 w-14 items-center justify-center">
                    <span
                      className="absolute inset-0 rounded-full border border-white/10 transition-all duration-500 ease-premium group-hover:scale-110 group-hover:border-cyan/30"
                      aria-hidden="true"
                    />
                    <span
                      className="absolute inset-2 rounded-full bg-gradient-c/25 blur-[6px] transition-opacity duration-500 group-hover:opacity-100 opacity-70"
                      aria-hidden="true"
                    />
                    <reason.icon
                      className="relative h-5 w-5 text-cyan transition-transform duration-300 ease-spring group-hover:scale-110"
                      aria-hidden="true"
                    />
                  </span>
                  <p className="font-semibold text-white">{reason.label}</p>
                  <p className="text-sm leading-relaxed text-slate-400">
                    {reason.body}
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
