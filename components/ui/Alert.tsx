import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm backdrop-blur-md",
        "animate-slide-down-fade",
        tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      )}
      style={{ animationFillMode: "both" }}
    >
      <span
        className={cn(
          "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          tone === "error" ? "bg-red-500/15" : "bg-emerald-500/15"
        )}
      >
        {tone === "error" ? (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}
