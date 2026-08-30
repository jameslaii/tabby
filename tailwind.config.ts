import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#241C17",
        ginger: { DEFAULT: "#D9730D", dark: "#B0560A" },
        teal: "#1A5754",
        paper: "#F7F2E9",
        card: "#FFFDF8",
        canvas: "#F7F2E9",
      },
      fontFamily: {
        // Loaded by next/font in app/layout.tsx, which sets these variables.
        // Naming a family Tailwind never fetches is what left the app with no
        // typeface of its own.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
