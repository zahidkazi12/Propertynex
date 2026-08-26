import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Heart, MessageSquare, UserRound, ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { StatCard } from "@/components/dashboard/StatCard";

export default async function DashboardOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard");

  const stats = [
    { icon: Building2, label: "Saved Properties", value: "0", hint: "Saving listings is coming soon" },
    { icon: Heart, label: "Favorites", value: "0", hint: "Saving listings is coming soon" },
    { icon: MessageSquare, label: "Messages", value: "0", hint: "Messaging launching soon" },
    { icon: UserRound, label: "Profile Strength", value: "Good", hint: "Add a photo to improve it" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
      {/* Welcome panel */}
      <div
        className="glass-card edge-glow relative overflow-hidden p-6 animate-fade-in sm:p-8 lg:p-10"
        style={{ animationFillMode: "both" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 100% at 0% 0%, rgba(37,99,235,0.22) 0%, transparent 60%)",
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 animate-aurora-a rounded-full bg-violet/15 blur-[70px]"
          aria-hidden="true"
        />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">
            Your dashboard
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-[2rem]">
            Welcome, {user.name.split(" ")[0]} 👋
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
            You&apos;re in early — your account is live, the marketplace is open for
            browsing, and you can list a property of your own whenever you&apos;re
            ready. Favourites and messaging are what we&apos;re building next.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard/properties/new"
              className="group inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-cyan/25 bg-cyan/10 px-4 py-2.5 text-sm font-semibold text-cyan transition-all duration-300 ease-premium hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-cyan/15"
            >
              List a property
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/dashboard/profile"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all duration-300 ease-premium hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08]"
            >
              Complete your profile
            </Link>
            <Link
              href="/buy"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all duration-300 ease-premium hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08]"
            >
              Browse listings
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xs:grid-cols-2 sm:gap-5 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className="animate-fade-in"
            style={{
              animationDelay: `${80 + index * 70}ms`,
              animationFillMode: "both",
            }}
          >
            <StatCard
              icon={stat.icon}
              label={stat.label}
              value={stat.value}
              hint={stat.hint}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
