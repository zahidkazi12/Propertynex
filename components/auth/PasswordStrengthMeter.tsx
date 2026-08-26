"use client";

import { cn } from "@/lib/utils/cn";

function scorePassword(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-cyan", "bg-emerald-500"];
const TEXT_COLORS = [
  "text-red-400",
  "text-orange-400",
  "text-yellow-400",
  "text-cyan",
  "text-emerald-400",
];

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);

  return (
    <div className="mt-2.5" aria-live="polite">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
          >
            {/* Inner fill scales in, so a rising score reads as growth rather
                than four independent colour flips. */}
            <div
              className={cn(
                "h-full w-full origin-left rounded-full transition-transform duration-500 ease-premium",
                i < score ? `${COLORS[score]} scale-x-100` : "scale-x-0"
              )}
            />
          </div>
        ))}
      </div>
      <p
        className={cn(
          "mt-1.5 text-xs font-medium transition-colors duration-300",
          TEXT_COLORS[score]
        )}
      >
        {LABELS[score]}
      </p>
    </div>
  );
}
