"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, LogOut, UserRound, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SafeUser } from "@/types";

export function Topbar({
  user,
  onMenuClick,
}: {
  user: SafeUser;
  onMenuClick: () => void;
}) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Escape closes the account menu — it was previously dismissible only by
  // clicking the backdrop, which keyboard users can't do.
  useEffect(() => {
    if (!dropdownOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDropdownOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropdownOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-navy-950/70 px-4 backdrop-blur-xl sm:px-6">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(6,182,212,0.3), transparent)",
        }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="hidden min-w-0 lg:block">
        <p className="truncate text-sm text-slate-400">
          Welcome back,{" "}
          <span className="font-semibold text-white">
            {user.name.split(" ")[0]}
          </span>
        </p>
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setDropdownOpen((open) => !open)}
          className={cn(
            "flex min-h-[44px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm transition-all duration-300 ease-premium",
            dropdownOpen
              ? "border-cyan/30 bg-white/[0.08] text-white"
              : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]"
          )}
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-b text-xs font-bold text-white shadow-glow">
            {initials || <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
          </span>
          <span className="hidden max-w-[120px] truncate font-medium sm:block">
            {user.name}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-300 ease-premium",
              dropdownOpen && "rotate-180 text-cyan"
            )}
            aria-hidden="true"
          />
        </button>

        <AnimatePresence>
          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDropdownOpen(false)}
                aria-hidden="true"
              />
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="glass-card absolute right-0 top-14 z-20 w-56 overflow-hidden p-1.5"
              >
                <div className="border-b border-white/10 px-3 pb-2.5 pt-1.5">
                  <p className="truncate text-sm font-semibold text-white">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                </div>

                <Link
                  href="/dashboard/profile"
                  role="menuitem"
                  onClick={() => setDropdownOpen(false)}
                  className="mt-1.5 flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/5 hover:text-white"
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  My Profile
                </Link>

                {/* Destructive action, separated from navigation above it. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="mt-0.5 flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 transition-colors duration-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loggingOut ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  )}
                  {loggingOut ? "Logging out…" : "Log out"}
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
