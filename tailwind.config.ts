import type { Config } from "tailwindcss";

/**
 * PROPERTYNEX design tokens.
 *
 * Brand stays as it was — deep navy base, royal/cyan/violet accents. What was
 * added in this pass is the supporting scale needed for a premium surface
 * treatment: extra navy steps for layered panels, accent tints for glows, a
 * motion vocabulary (ambient drift, sheen, reveal) and two shared easing curves
 * so every transition in the app has the same rhythm.
 *
 * Note on `colors`: Tailwind deep-merges `extend.colors`, so declaring only
 * `DEFAULT` on `cyan`/`violet` keeps their full built-in 50–950 ramps available
 * (`text-cyan-300` still resolves). `royal` is a custom name with no built-in
 * ramp, so its steps are spelled out.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Narrow-phone breakpoint: lets 320–414px layouts step up without
        // waiting for `sm` (640px).
        xs: "400px",
      },
      colors: {
        navy: {
          DEFAULT: "#0B1220",
          950: "#020617",
          900: "#0F172A",
          850: "#111C31",
          800: "#16213C",
          700: "#1E2B4A",
        },
        royal: {
          DEFAULT: "#2563EB",
          300: "#7DA7F8",
          400: "#3B82F6",
          500: "#2563EB",
          600: "#1D4ED8",
        },
        cyan: {
          DEFAULT: "#06B6D4",
        },
        violet: {
          DEFAULT: "#7C3AED",
        },
        surface: {
          light: "#F8FAFC",
        },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "Inter", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-a": "linear-gradient(135deg, #0B1220 0%, #2563EB 100%)",
        "gradient-b": "linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)",
        "gradient-c": "linear-gradient(135deg, #7C3AED 0%, #2563EB 100%)",
        "gradient-d": "linear-gradient(135deg, #0B1220 0%, #7C3AED 100%)",
        // Tri-tone brand sweep, used for animated text and hairline borders.
        "gradient-brand":
          "linear-gradient(115deg, #7C3AED 0%, #2563EB 45%, #06B6D4 100%)",
        "gradient-sheen":
          "linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.28) 50%, transparent 80%)",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(2, 6, 23, 0.37)",
        glow: "0 0 40px 0 rgba(37, 99, 235, 0.25)",
        "glow-lg": "0 12px 48px -8px rgba(37, 99, 235, 0.45)",
        "glow-cyan": "0 0 40px 0 rgba(6, 182, 212, 0.28)",
        "glow-violet": "0 0 40px 0 rgba(124, 58, 237, 0.28)",
        // `box-shadow` is a single property, so a second shadow utility replaces
        // the first rather than adding to it. These composites bundle the glass
        // drop shadow together with the top-edge light catch that reads as glass
        // thickness, so a card keeps both.
        "glass-raised":
          "inset 0 1px 0 0 rgba(255,255,255,0.07), 0 8px 32px 0 rgba(2,6,23,0.37)",
        "card-hover":
          "inset 0 1px 0 0 rgba(255,255,255,0.10), 0 2px 4px 0 rgba(2,6,23,0.4), 0 24px 56px -16px rgba(2,6,23,0.75)",
        hairline: "inset 0 1px 0 0 rgba(255,255,255,0.07)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "orb-float": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(20px, -30px) scale(1.05)" },
        },
        "grid-pan": {
          "0%": { backgroundPosition: "0px 0px" },
          "100%": { backgroundPosition: "64px 64px" },
        },
        // Ambient background: long, irregular drift so two orbs never look
        // like they share a timeline.
        "aurora-a": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "33%": { transform: "translate3d(6%, -4%, 0) scale(1.08)" },
          "66%": { transform: "translate3d(-4%, 5%, 0) scale(0.96)" },
        },
        "aurora-b": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1.04)" },
          "40%": { transform: "translate3d(-7%, 4%, 0) scale(0.94)" },
          "70%": { transform: "translate3d(5%, 6%, 0) scale(1.1)" },
        },
        "float-y": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "float-y-sm": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        // Light sweep across a button/card on hover. Range is in units of the
        // sweep element's own width (50% of the button), so -220%→320% carries
        // it fully off one edge and off the other.
        sheen: {
          "0%": { transform: "translateX(-220%)" },
          "100%": { transform: "translateX(320%)" },
        },
        // Animated brand gradient for headline text. Pair with
        // `bg-[length:220%_auto]`.
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(2.2)", opacity: "0" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        // Vertical scan line for the hero visual.
        scan: {
          "0%": { transform: "translateY(-100%)", opacity: "0" },
          "45%": { opacity: "1" },
          "100%": { transform: "translateY(400%)", opacity: "0" },
        },
        "error-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-3px)" },
          "40%, 80%": { transform: "translateX(3px)" },
        },
        "slide-down-fade": {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.6s ease-out forwards",
        "orb-float": "orb-float 12s ease-in-out infinite",
        "grid-pan": "grid-pan 24s linear infinite",
        "aurora-a": "aurora-a 28s ease-in-out infinite",
        "aurora-b": "aurora-b 34s ease-in-out infinite",
        "float-y": "float-y 6s ease-in-out infinite",
        "float-y-sm": "float-y-sm 5s ease-in-out infinite",
        sheen: "sheen 0.9s ease-out",
        "gradient-shift": "gradient-shift 8s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.24,0.8,0.36,1) infinite",
        "spin-slow": "spin-slow 22s linear infinite",
        shimmer: "shimmer 2.2s linear infinite",
        scan: "scan 7s ease-in-out infinite",
        "error-shake": "error-shake 0.4s ease-in-out",
        "slide-down-fade": "slide-down-fade 0.18s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
