"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  UserRound,
  Building2,
  Heart,
  MessageSquare,
  Settings,
  X,
  Lock,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Profile", href: "/dashboard/profile", icon: UserRound, enabled: true },
  { label: "My Properties", href: "/dashboard/properties", icon: Building2, enabled: true },
  { label: "Favorites", href: "#", icon: Heart, enabled: false },
  { label: "Messages", href: "#", icon: MessageSquare, enabled: false },
  { label: "Settings", href: "#", icon: Settings, enabled: false },
];

/**
 * Is this nav item the one the current URL belongs to?
 *
 * Prefix matching, not equality, because sections have children now:
 * `/dashboard/properties/<id>/photos` is still "My Properties", and highlighting
 * nothing while the seller is two levels deep in a section reads as being lost.
 *
 * `/dashboard` itself is the exception — every route starts with it, so it would
 * match everything and the whole rail would light up. It is matched exactly.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * `scope` keeps the sliding active-indicator unique per instance. The sidebar
 * renders twice — once as the desktop rail, once inside the mobile slide-over —
 * and two elements sharing one `layoutId` would make Framer animate the
 * indicator between the two copies.
 */
function SidebarContent({
  scope,
  onNavigate,
}: {
  scope: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-6">
        <Logo />
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Dashboard">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);

          if (!item.enabled) {
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-600"
                title="Coming soon"
                aria-disabled="true"
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  {item.label}
                </span>
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-premium",
                active
                  ? "text-white"
                  : "text-slate-300 hover:translate-x-0.5 hover:bg-white/5 hover:text-white"
              )}
            >
              {active && (
                <motion.span
                  layoutId={`dash-active-${scope}`}
                  className="absolute inset-0 -z-10 rounded-xl bg-gradient-b shadow-glow"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-transform duration-300 ease-spring",
                  !active && "group-hover:scale-110"
                )}
                aria-hidden="true"
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-6">
        <div className="glass-panel relative overflow-hidden rounded-xl p-4">
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan/15 blur-2xl"
            aria-hidden="true"
          />
          <p className="relative text-xs font-semibold uppercase tracking-wide text-cyan">
            Foundation build
          </p>
          <p className="relative mt-1.5 text-xs leading-relaxed text-slate-400">
            You&apos;re using the early PROPERTYNEX platform. More features are on
            the way.
          </p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  // Escape closes the slide-over, and the page behind it stops scrolling while
  // it is open.
  useEffect(() => {
    if (!mobileOpen) return;

    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen, onClose]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="relative hidden w-64 shrink-0 border-r border-white/10 bg-navy-900/50 backdrop-blur-xl lg:block">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(6,182,212,0.25), transparent)",
          }}
          aria-hidden="true"
        />
        <SidebarContent scope="desktop" />
      </aside>

      {/* Mobile slide-over */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-navy-950/80 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-white/10 bg-navy-900 shadow-2xl lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Dashboard navigation"
            >
              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:bg-white/5"
                aria-label="Close menu"
              >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
              <SidebarContent scope="mobile" onNavigate={onClose} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
