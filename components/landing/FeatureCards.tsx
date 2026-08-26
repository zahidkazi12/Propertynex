"use client";

import { motion } from "framer-motion";
import { Building2, Key, Hammer, Users, MapPin, SearchCheck } from "lucide-react";
import { Reveal, EASE_PREMIUM } from "@/components/ui/Reveal";

const FEATURES = [
  { icon: Building2, label: "Buy Property", desc: "Browse verified homes and investments." },
  { icon: Key, label: "Rent Property", desc: "Find your next place, on your terms." },
  { icon: Hammer, label: "Sell Property", desc: "List and reach serious buyers." },
  { icon: Users, label: "Connect with Agents", desc: "Work with trusted professionals." },
  { icon: MapPin, label: "Discover Locations", desc: "Explore neighborhoods that fit you." },
  { icon: SearchCheck, label: "Smart Property Search", desc: "Filter by what actually matters." },
];

export function FeatureCards() {
  return (
    <section id="features" className="section-y relative scroll-mt-24">
      {/* Section-scoped glow so the grid of cards sits in its own pool of light. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/4 h-96"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 50%, rgba(124,58,237,0.10) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="shell relative">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Platform features</span>
          <h2 className="section-heading mt-5">
            Everything, <span className="gradient-text">in one place</span>
          </h2>
          <p className="section-sub">
            A preview of what PROPERTYNEX is building toward.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.label}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.5,
                delay: (index % 3) * 0.07,
                ease: EASE_PREMIUM,
              }}
              className="glass-card group relative overflow-hidden p-6 card-interactive"
            >
              <div className="card-spotlight" aria-hidden="true" />

              {/* Ghosted index — depth without adding another visible label. */}
              <span
                className="pointer-events-none absolute right-4 top-3 text-5xl font-extrabold text-white/[0.03] transition-colors duration-500 group-hover:text-white/[0.06] tabular"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-b shadow-glow transition-all duration-300 ease-spring group-hover:scale-110 group-hover:rotate-3 group-hover:shadow-glow-cyan">
                  <feature.icon className="h-5 w-5 text-white" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white transition-colors duration-300 group-hover:text-cyan">
                  {feature.label}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {feature.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
