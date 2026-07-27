import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#2A211C",
        ginger: { DEFAULT: "#D9730D", dark: "#B85A0A" },
        teal: "#1F5F5B",
        paper: "#F5D9B0",
        canvas: "#FDFBF9",
      },
      fontFamily: {
        sans: ["ui-rounded", "Nunito", "Quicksand", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
