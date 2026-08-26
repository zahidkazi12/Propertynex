"use client";

import { motion } from "framer-motion";

/** Shared easing — the JS twin of `ease-premium` in the Tailwind config. */
export const EASE_PREMIUM: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Seconds to wait before starting. Use `index * 0.06` for a grid stagger. */
  delay?: number;
  /** Starting offset in px. 0 gives a pure fade. */
  y?: number;
  duration?: number;
}

/**
 * Scroll-triggered fade + rise.
 *
 * Wraps the `initial / whileInView / viewport` triple that was being repeated in
 * every landing section, so the whole page reveals with one timing curve. Fires
 * once per element and unhooks itself, so there is no scroll listener and no
 * repeated state churn.
 *
 * Under `prefers-reduced-motion` the vertical offset is dropped by
 * MotionProvider's `reducedMotion="user"` and only the opacity remains.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  duration = 0.55,
}: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration, delay, ease: EASE_PREMIUM }}
    >
      {children}
    </motion.div>
  );
}
