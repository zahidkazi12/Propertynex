import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { AmbientBackground } from "@/components/layout/AmbientBackground";

const PANEL_POINTS = [
  { icon: ShieldCheck, label: "Passcode-verified account recovery" },
  { icon: Lock, label: "Sessions you can end from any device" },
  { icon: Sparkles, label: "Built for the marketplace launch" },
];

export function AuthShell({
  children,
  imageAlt,
  imageSrc,
  panelTitle,
  panelSubtitle,
}: {
  children: React.ReactNode;
  imageAlt: string;
  imageSrc: string;
  panelTitle: string;
  panelSubtitle: string;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      <AmbientBackground />

      {/* Left / brand panel — desktop only */}
      <div className="relative hidden overflow-hidden border-r border-white/10 lg:flex lg:w-[46%] xl:w-1/2">
        <div className="absolute inset-0 bg-gradient-d" aria-hidden="true" />
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          sizes="50vw"
          className="object-cover opacity-25 mix-blend-overlay"
          priority
        />
        {/* Panel-local aurora, so the brand side reads brighter than the form. */}
        <div
          className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 animate-aurora-a rounded-full bg-royal/25 blur-[120px]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 animate-aurora-b rounded-full bg-cyan/15 blur-[110px]"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-transparent to-navy-950/30"
          aria-hidden="true"
        />

        <div className="relative z-10 flex w-full flex-col justify-between p-10 xl:p-14">
          <Logo />

          <div>
            <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
              {panelTitle}
            </h2>
            <p className="mt-4 max-w-sm leading-relaxed text-slate-300">
              {panelSubtitle}
            </p>

            <ul className="mt-9 space-y-3">
              {PANEL_POINTS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-3 text-sm text-slate-300"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                    <Icon className="h-4 w-4 text-cyan" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-slate-500">PROPERTYNEX © 2026</p>
        </div>
      </div>

      {/* Right / form panel */}
      <main
        id="main-content"
        className="relative z-10 flex w-full flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-12 lg:px-10 xl:px-16"
      >
        <div className="w-full max-w-md">
          <div className="mb-7 flex justify-center lg:hidden">
            <Logo />
          </div>

          <div
            className="glass-card edge-glow relative overflow-hidden p-5 animate-fade-in xs:p-6 sm:p-8"
            style={{ animationFillMode: "both" }}
          >
            {children}
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 px-2 transition-colors hover:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
