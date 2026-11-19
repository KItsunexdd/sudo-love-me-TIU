import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#07110E", panel: "#0D1B17", line: "#1C382F",
        accent: "#00D084", gold: "#F59E0B", alert: "#EF4444",
      },
      fontFamily: { sans: ["Inter", "sans-serif"], mono: ["JetBrains Mono", "monospace"] },
    },
  },
} satisfies Config;
