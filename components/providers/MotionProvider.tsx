"use client";

import { MotionConfig } from "framer-motion";

/**
 * Global Framer Motion configuration.
 *
 * The `prefers-reduced-motion` block in globals.css collapses CSS animation and
 * transition durations, but it cannot reach Framer Motion: those animations are
 * driven in JS and written to inline styles, so a CSS `transition-duration`
 * override has no effect on them. `reducedMotion="user"` closes that gap —
 * Framer then skips transform/layout animation for users who asked for reduced
 * motion, while still allowing opacity crossfades, so content that animates in
 * on scroll still becomes visible rather than never appearing.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
