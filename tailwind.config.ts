import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        canvas: "#07110E",
        terminal: "#050C0A",
        surface: "#0D1B17",
        elevated: "#122620",
        "surface-hover": "#173129",
        "border-subtle": "#152B24",
        "border-default": "#1C382F",
        "border-strong": "#2B5447",
        ink: {
          primary: "#F0FDF8",
          secondary: "#A7C4BA",
          muted: "#7FA397",
          disabled: "#4E6E63",
          inverse: "#04120D",
        },
        bcc: { DEFAULT: "#00D084", hover: "#1AF0A0", active: "#00B572", soft: "#10B981" },
        gold: { DEFAULT: "#F59E0B", hover: "#FBBF24", active: "#D97706" },
        danger: { DEFAULT: "#EF4444", solid: "#DC2626", text: "#FCA5A5" },
        quantum: "#38BDF8",
        panel: "#0D1B17",
        line: "#1C382F",
        accent: "#00D084",
        alert: "#EF4444",
      },
      borderRadius: { phone: "var(--radius-phone)" },
      boxShadow: {
        card: "var(--shadow-card)",
        modal: "var(--shadow-modal)",
        phone: "var(--shadow-phone)",
        "glow-bcc": "var(--shadow-glow-emerald)",
        "glow-emerald": "var(--shadow-glow-emerald)",
        "glow-danger": "var(--shadow-glow-danger)",
        "glow-gold": "var(--shadow-glow-gold)",
        "glow-quantum": "var(--shadow-glow-quantum)",
      },
      backgroundImage: {
        "account-card": "var(--gradient-account-card)",
        "account-card-b2b": "var(--gradient-account-card-b2b)",
        "shield-success": "var(--gradient-shield-success)",
        "shield-cosign": "var(--gradient-shield-cosign)",
        "shield-danger": "var(--gradient-shield-danger)",
      },
    },
  },
} satisfies Config;
