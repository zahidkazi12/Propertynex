/**
 * Full-page futuristic ambient background.
 *
 * Deliberately lightweight: CSS gradients, blurred radial "aurora" blobs, a
 * masked grid, a slow conic sweep and a handful of drifting dots — no canvas,
 * no WebGL, no per-frame JS, no React state. Everything is `position: fixed`,
 * `pointer-events-none` and `aria-hidden`, so it never affects layout,
 * interaction or screen readers.
 *
 * Every animation drives `transform` or `background-position` only, which the
 * compositor can run on the GPU without laying out or painting the page each
 * frame. The `will-drift` hint is applied to the four large blobs only —
 * promoting every layer would cost more memory than it saves.
 *
 * `prefers-reduced-motion: reduce` is handled globally in globals.css (all
 * animation/transition durations collapse to ~0), so the scene simply renders
 * as a still gradient. Nothing here needs its own branch.
 *
 * Particle positions are a fixed table rather than `Math.random()` so server
 * and client markup agree.
 */

const PARTICLES = [
  { left: "8%", top: "18%", size: 3, delay: "0s", duration: "7s" },
  { left: "22%", top: "62%", size: 2, delay: "-2.5s", duration: "9s" },
  { left: "35%", top: "28%", size: 2, delay: "-4s", duration: "8s" },
  { left: "48%", top: "74%", size: 3, delay: "-1.2s", duration: "10s" },
  { left: "61%", top: "16%", size: 2, delay: "-5.5s", duration: "7.5s" },
  { left: "72%", top: "48%", size: 3, delay: "-3s", duration: "9.5s" },
  { left: "84%", top: "70%", size: 2, delay: "-6s", duration: "8.5s" },
  { left: "92%", top: "32%", size: 2, delay: "-0.8s", duration: "11s" },
  { left: "15%", top: "88%", size: 2, delay: "-7s", duration: "9s" },
  { left: "56%", top: "92%", size: 2, delay: "-4.8s", duration: "10.5s" },
] as const;

export function AmbientBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-navy-950"
      aria-hidden="true"
    >
      {/* Base atmosphere — deep navy with a violet lean toward the bottom. */}
      <div className="absolute inset-0 bg-gradient-d opacity-[0.45]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, rgba(37,99,235,0.20) 0%, transparent 60%)",
        }}
      />

      {/* Slow conic sweep: reads as a light source rotating far overhead. */}
      <div
        className="absolute -top-1/2 left-1/2 h-[120vh] w-[120vh] -translate-x-1/2 animate-spin-slow opacity-[0.07]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(6,182,212,0.7) 40deg, transparent 90deg, transparent 200deg, rgba(124,58,237,0.6) 250deg, transparent 300deg)",
        }}
      />

      {/* Blueprint grid, panning slowly and masked out toward the edges so it
          never reads as a hard checkerboard. */}
      <div className="absolute inset-0 mask-fade-edges">
        <div className="bg-grid absolute inset-0 animate-grid-pan opacity-[0.055]" />
      </div>

      {/* Aurora field. Two drift keyframes at different periods, offset by
          negative delays, so no two blobs ever share a phase. */}
      <div className="will-drift absolute -top-40 left-[15%] h-[34rem] w-[34rem] animate-aurora-a rounded-full bg-royal/[0.18] blur-[130px]" />
      <div
        className="will-drift absolute top-[34%] -right-40 h-[38rem] w-[38rem] animate-aurora-b rounded-full bg-cyan/[0.11] blur-[140px]"
        style={{ animationDelay: "-8s" }}
      />
      <div
        className="will-drift absolute bottom-0 -left-24 h-[30rem] w-[30rem] animate-aurora-b rounded-full bg-violet/[0.13] blur-[125px]"
        style={{ animationDelay: "-18s" }}
      />
      <div
        className="will-drift absolute bottom-[12%] right-[18%] h-[24rem] w-[24rem] animate-aurora-a rounded-full bg-royal/[0.10] blur-[110px]"
        style={{ animationDelay: "-13s" }}
      />

      {/* Minimal particle field — ten drifting motes, cyan at low alpha. */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-cyan/40 animate-float-y"
          style={{
            left: p.left,
            top: p.top,
            height: p.size,
            width: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
            boxShadow: "0 0 8px 1px rgba(6,182,212,0.35)",
          }}
        />
      ))}

      {/* Vignette so text stays legible at the very top and bottom edges. */}
      <div className="absolute inset-0 bg-gradient-to-b from-navy-950/50 via-transparent to-navy-950/80" />
    </div>
  );
}
