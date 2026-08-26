"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils/cn";

/**
 * Primary navigation.
 *
 * Every link here is real. Buy, Sell and Rent were previously rendered disabled
 * with a "coming soon" treatment, because the routes did not exist; they now do
 * (`app/buy`, `app/sell`, `app/rent`), so the disabled branch and its
 * `plannedHref` bookkeeping are gone rather than left behind switched off.
 * "Explore" is gone too — it was a placeholder for the browse experience that
 * `/buy` and `/rent` now provide directly, and keeping a fifth disabled entry
 * beside three working ones would only re-introduce the confusion this fixes.
 *
 * Two kinds of destination, distinguished because they highlight differently:
 *
 *   - `route` links own a page. Current when the pathname matches.
 *   - `sectionId` links scroll to a section of the landing page. Current when
 *     that section is in reading position, tracked by the observer below.
 *
 * `About` keeps the `/#about` form rather than a bare `#about`: the bar is
 * global, so from `/buy` a bare hash would look for an About section on the buy
 * page and find nothing. With the leading `/` it routes home and then scrolls,
 * from anywhere.
 */
type NavLink = {
  readonly label: string;
  readonly href: string;
  /** Section id on the landing page, when this link targets one. */
  readonly sectionId?: string;
  /** Pathname this link owns, when it targets a page of its own. */
  readonly route?: string;
};

const NAV_LINKS: readonly NavLink[] = [
  { label: "Home", href: "/", sectionId: "home" },
  { label: "Buy", href: "/buy", route: "/buy" },
  { label: "Sell", href: "/sell", route: "/sell" },
  { label: "Rent", href: "/rent", route: "/rent" },
  { label: "About", href: "/#about", sectionId: "about" },
];

const TRACKED_SECTIONS = NAV_LINKS.flatMap((l) => (l.sectionId ? [l.sectionId] : []));

export function Navbar() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [observedSection, setObservedSection] = useState<string>("home");

  // Derived rather than stored: off the landing page there are no sections to
  // observe, so nothing should read as current. Computing it here avoids a
  // setState-inside-effect just to clear it on navigation.
  const activeSection = isLanding ? observedSection : null;

  /**
   * One definition of "current", shared by the desktop pill and the mobile
   * sheet. Route links match the pathname; section links match whatever the
   * observer last saw. Previously the mobile branch re-derived this inline three
   * times, which is how the two lists drift apart.
   */
  const isLinkActive = (link: NavLink) =>
    link.route != null
      ? pathname === link.route
      : link.sectionId != null && activeSection === link.sectionId;

  // Mirrors `scrolled` so the listener can skip the state call entirely when
  // nothing changed, rather than relying on React to bail out.
  const scrolledRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 12;
      if (next === scrolledRef.current) return;
      scrolledRef.current = next;
      setScrolled(next);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /**
   * Active-section indicator.
   *
   * An IntersectionObserver with a narrow band near the top of the viewport, so
   * a section becomes "current" as it reaches reading position. This fires only
   * when a section crosses the band — there is no scroll handler and no
   * per-frame state update.
   */
  useEffect(() => {
    if (!isLanding) return;

    const sections = TRACKED_SECTIONS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entered = entries.find((entry) => entry.isIntersecting);
        if (entered) setObservedSection(entered.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [isLanding]);

  // Lock page scroll behind the mobile sheet, and let Escape close it.
  useEffect(() => {
    if (!menuOpen) return;

    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-premium",
        scrolled
          ? "border-b border-white/10 bg-navy-950/70 shadow-glass backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      {/* Hairline that fades in with the glass, so the bar gains an edge rather
          than a hard line. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px transition-opacity duration-500",
          scrolled ? "opacity-100" : "opacity-0"
        )}
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(6,182,212,0.45), rgba(124,58,237,0.35), transparent)",
        }}
        aria-hidden="true"
      />

      <nav
        className="shell flex h-16 items-center justify-between gap-4"
        aria-label="Primary"
      >
        <Logo />

        {/* Desktop links, grouped in a glass pill. */}
        <ul className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md lg:flex">
          {NAV_LINKS.map((link) => {
            const isActive = isLinkActive(link);

            return (
              <li key={link.label} className="relative">
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-300",
                    isActive ? "text-white" : "text-slate-300 hover:text-white"
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 -z-10 rounded-full border border-cyan/25 bg-cyan/10"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className="btn-ghost px-4">
            Log in
          </Link>
          <Link href="/signup" className="btn-primary group px-5 py-2.5 text-sm">
            Get Started
            <ArrowRight
              className="h-4 w-4 transition-transform duration-300 ease-premium group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-100 transition-colors duration-200 hover:bg-white/10 lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          <AnimatePresence mode="wait" initial={false}>
            {menuOpen ? (
              <motion.span
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </motion.span>
            ) : (
              <motion.span
                key="open"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-white/10 bg-navy-950/95 backdrop-blur-xl lg:hidden"
          >
            <ul className="flex max-h-[calc(100dvh-8rem)] flex-col gap-1 overflow-y-auto px-4 py-4">
              {NAV_LINKS.map((link, index) => {
                const isActive = isLinkActive(link);

                return (
                  <motion.li
                    key={link.label}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 + index * 0.035, duration: 0.25 }}
                  >
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex min-h-[44px] items-center rounded-xl px-3 py-2.5 text-base font-medium transition-colors",
                        isActive ? "bg-cyan/10 text-white" : "text-slate-200 hover:bg-white/5"
                      )}
                    >
                      {link.label}
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-2.5 border-t border-white/10 px-4 py-4">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="btn-secondary w-full"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setMenuOpen(false)}
                className="btn-primary w-full"
              >
                Get Started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
