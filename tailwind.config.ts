import type { Config } from "tailwindcss";

// 色の実体は globals.css の CSS 変数（--color-*）。[data-theme="dark"] で値が差し替わる。
// Tailwind には「<alpha-value> プレースホルダ付きの rgb()」として渡し、bg-ink/30 のような透明度指定を効かせる。
const themed = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: themed("primary"),
          active: themed("primary-active"),
          disabled: themed("primary-disabled"),
        },
        ink: themed("ink"),
        body: {
          DEFAULT: themed("body"),
          strong: themed("body-strong"),
        },
        muted: {
          DEFAULT: themed("muted"),
          soft: themed("muted-soft"),
        },
        hairline: {
          DEFAULT: themed("hairline"),
          soft: themed("hairline-soft"),
        },
        canvas: themed("canvas"),
        surface: {
          soft: themed("surface-soft"),
          card: themed("surface-card"),
          "cream-strong": themed("surface-cream-strong"),
          dark: themed("surface-dark"),
          "dark-elevated": themed("surface-dark-elevated"),
          "dark-soft": themed("surface-dark-soft"),
        },
        "on-primary": themed("on-primary"),
        "on-dark": {
          DEFAULT: themed("on-dark"),
          soft: themed("on-dark-soft"),
        },
        accent: {
          steel: themed("accent-steel"),
          mauve: themed("accent-mauve"),
        },
        success: themed("success"),
        warning: themed("warning"),
        error: themed("error"),
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
          "var(--font-display)",
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
