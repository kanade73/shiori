import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#6b5496",
          active: "#4a396a",
          disabled: "#dfdde4",
        },
        ink: "#121421",
        body: {
          DEFAULT: "#3b3e54",
          strong: "#25283c",
        },
        muted: {
          DEFAULT: "#676b83",
          soft: "#8a8d9e",
        },
        hairline: {
          DEFAULT: "#ece3df",
          soft: "#f1ecea",
        },
        canvas: "#fbf7f6",
        surface: {
          soft: "#f8f2ef",
          card: "#f2e8e4",
          "cream-strong": "#ebded8",
          dark: "#121421",
          "dark-elevated": "#1e2133",
          "dark-soft": "#181a2a",
        },
        "on-primary": "#ffffff",
        "on-dark": {
          DEFAULT: "#f7f5f5",
          soft: "#9497a8",
        },
        accent: {
          steel: "#505b95",
          mauve: "#9f90bb",
        },
        success: "#4caa77",
        warning: "#cf9a3a",
        error: "#c6435a",
      },
      fontSize: {
        "display-xl": ["64px", { lineHeight: "1.05", letterSpacing: "-1.5px" }],
        "display-lg": ["48px", { lineHeight: "1.1", letterSpacing: "-1px" }],
        "display-md": ["36px", { lineHeight: "1.15", letterSpacing: "-0.5px" }],
        "display-sm": ["28px", { lineHeight: "1.2", letterSpacing: "-0.3px" }],
        "title-lg": ["22px", { lineHeight: "1.3" }],
        "title-md": ["18px", { lineHeight: "1.4" }],
        "title-sm": ["16px", { lineHeight: "1.4" }],
        "body-md": ["16px", { lineHeight: "1.55" }],
        "body-sm": ["14px", { lineHeight: "1.55" }],
        caption: ["13px", { lineHeight: "1.4" }],
        "caption-uppercase": ["12px", { lineHeight: "1.4", letterSpacing: "1.5px" }],
      },
      fontFamily: {
        display: [
          "var(--font-sans)",
          "Noto Sans JP",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "sans-serif",
        ],
        sans: [
          "var(--font-sans)",
          "Noto Sans JP",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        pill: "9999px",
      },
      spacing: {
        xxs: "4px",
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        xxl: "48px",
        section: "96px",
      },
      keyframes: {
        tilt: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(-2deg)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 80%, 100%": { opacity: "0.25", transform: "translateY(0)" },
          "40%": { opacity: "1", transform: "translateY(-2px)" },
        },
      },
      animation: {
        tilt: "tilt 9s ease-in-out infinite",
        "fade-up": "fade-up 0.25s ease-out",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
