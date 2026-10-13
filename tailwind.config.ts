import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08080d",
          900: "#0c0c13",
          850: "#101019",
          800: "#14141f",
          700: "#1b1b29",
          600: "#262636",
        },
        text: {
          DEFAULT: "#e8e8f0",
          muted: "#9a9ab0",
          faint: "#63637a",
        },
        accent: {
          DEFAULT: "#7c6cff",
          soft: "#a79bff",
          deep: "#5b4bf0",
        },
        cyan: { DEFAULT: "#22d3ee", soft: "#67e8f9" },
        mint: { DEFAULT: "#34d399", soft: "#6ee7b7" },
        amber: { DEFAULT: "#fbbf24" },
        rose: { DEFAULT: "#fb7185" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,108,255,0.25), 0 8px 40px -8px rgba(124,108,255,0.45)",
        "glow-cyan": "0 0 0 1px rgba(34,211,238,0.22), 0 8px 40px -8px rgba(34,211,238,0.4)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -30px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "radial-fade":
          "radial-gradient(1200px 600px at 50% -10%, rgba(124,108,255,0.14), transparent 60%)",
        "grid-faint":
          "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 2.5s linear infinite",
        "float-slow": "float-slow 7s ease-in-out infinite",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
