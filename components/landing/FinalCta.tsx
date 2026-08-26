"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

export function FinalCta() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="shell">
        <Reveal>
          {/* Gradient hairline frame around the panel. */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-brand p-px shadow-glow-lg">
            <div className="relative overflow-hidden rounded-3xl bg-navy-950 px-6 py-14 text-center sm:px-12 sm:py-20">
              {/* Panel-local light: one warm core plus two drifting accents. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(70% 90% at 50% 0%, rgba(37,99,235,0.28) 0%, transparent 65%)",
                }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute -bottom-10 -left-20 h-64 w-64 animate-aurora-a rounded-full bg-violet/20 blur-[90px]"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute -right-16 -top-10 h-56 w-56 animate-aurora-b rounded-full bg-cyan/15 blur-[80px]"
                aria-hidden="true"
              />

              <div className="relative mx-auto max-w-2xl">
                <span className="eyebrow">Get started</span>
                <h2 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
                  Your next property could be closer than you think.
                </h2>
                <p className="mt-4 text-base text-slate-300 sm:text-lg">
                  Browse what&apos;s listed today, and create an account when
                  you&apos;re ready to list your own.
                </p>
                <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
                  <Link href="/signup" className="btn-primary group px-8 text-base">
                    Join PROPERTYNEX
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </Link>
                  <Link href="/buy" className="btn-secondary px-8 text-base">
                    Browse listings
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
