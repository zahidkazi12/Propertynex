import type { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="glass-card group relative overflow-hidden p-5 transition-all duration-300 ease-premium hover:-translate-y-1 hover:border-cyan/25 hover:shadow-card-hover">
      <div className="card-spotlight" aria-hidden="true" />

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-b/20 transition-all duration-300 ease-spring group-hover:scale-110 group-hover:border-cyan/30">
            <Icon className="h-5 w-5 text-cyan" aria-hidden="true" />
          </span>
          <span className="badge-soft shrink-0">Coming soon</span>
        </div>

        <p className="mt-4 text-2xl font-bold text-white tabular">{value}</p>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
      </div>
    </div>
  );
}
