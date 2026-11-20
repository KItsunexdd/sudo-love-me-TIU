import type { Config } from "tailwindcss";

// Graphite ramp: surfaces stay neutral, colour lives in the accent and the data.
// Token names are kept from the first design pass so every screen picks up the new values.
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        canvas: "#131415",
        terminal: "#0E0F10",
        surface: "#18191B",
        elevated: "#212225",
        "surface-hover": "#27282B",
        "border-subtle": "#222326",
        "border-default": "#2A2B2E",
        "border-strong": "#36383C",
        ink: {
          primary: "#ECEEF0",
          secondary: "#A2A6AD",
          muted: "#868A91",
          disabled: "#5C6067",
          inverse: "#0E0F10",
        },
        // BCC green: the ink of a valid signature. Used for the primary action, selection and verified states.
        bcc: { DEFAULT: "#2FBF84", hover: "#3FD394", active: "#27A673", soft: "#2FBF84" },
        // Amber: waiting for the second hand.
        gold: { DEFAULT: "#D9A441", hover: "#E6B457", active: "#C08F33", text: "#E8B860" },
        // Red: the ink of an attack.
        danger: { DEFAULT: "#E5484D", solid: "#CF3A3F", hover: "#B93338", text: "#F07A7D" },
        // Post-quantum layer, used only where the two signature layers are compared.
        quantum: "#7AB3DE",
        panel: "#18191B",
        line: "#2A2B2E",
        accent: "#2FBF84",
        alert: "#E5484D",
      },
      borderRadius: { phone: "var(--radius-phone)" },
      boxShadow: {
        card: "none",
        modal: "var(--shadow-modal)",
        phone: "var(--shadow-phone)",
        "glow-bcc": "none",
        "glow-emerald": "none",
        "glow-danger": "none",
        "glow-gold": "none",
        "glow-quantum": "none",
        highlight: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
      },
      backgroundImage: {
        "account-card": "none",
        "account-card-b2b": "none",
        "shield-success": "none",
        "shield-cosign": "none",
        "shield-danger": "none",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.22, 1, 0.36, 1)",
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        DEFAULT: "160ms",
      },
    },
  },
} satisfies Config;
