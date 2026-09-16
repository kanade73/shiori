import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 色は CSS 変数（app/globals.css）で持つ。既定はダーク。
      // `<alpha-value>` を使うので値は "r g b" の三つ組で定義する
      colors: {
        primary: {
          DEFAULT: v("primary"),
          active: v("primary-active"),
          disabled: v("primary-disabled"),
        },
        ink: v("ink"),
        body: {
          DEFAULT: v("body"),
          strong: v("body-strong"),
        },
        muted: {
          DEFAULT: v("muted"),
          soft: v("muted-soft"),
        },
        hairline: {
          DEFAULT: v("hairline"),
          soft: v("hairline-soft"),
        },
        canvas: v("canvas"),
        surface: {
          soft: v("surface-soft"),
          card: v("surface-card"),
          "cream-strong": v("surface-cream-strong"),
          dark: v("surface-dark"),
          "dark-elevated": v("surface-dark-elevated"),
          "dark-soft": v("surface-dark-soft"),
        },
        "on-primary": v("on-primary"),
        "on-dark": {
          DEFAULT: v("on-dark"),
          soft: v("on-dark-soft"),
        },
        accent: {
          steel: v("accent-steel"),
          mauve: v("accent-mauve"),
        },
        success: v("success"),
        warning: v("warning"),
        error: v("error"),
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
        // 小さなラベル専用のドットフォント。本文には使わない
        pixel: ["var(--font-pixel)", "DotGothic16", "var(--font-sans)", "sans-serif"],
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
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
        "delete-dialog-exit": {
          "0%, 30%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-12px) scale(0.96)" },
        },
        "typing-dot": {
          "0%, 80%, 100%": { opacity: "0.25", transform: "translateY(0)" },
          "40%": { opacity: "1", transform: "translateY(-2px)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        tilt: "tilt 9s ease-in-out infinite",
        "fade-up": "fade-up 0.3s steps(4, end)",
        "delete-dialog-exit": "delete-dialog-exit 0.9s steps(9, end) forwards",
        "typing-dot": "typing-dot 1.2s steps(2, end) infinite",
        blink: "blink 1s steps(2, end) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
