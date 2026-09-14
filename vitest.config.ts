import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// lib/ は node 環境、components/ と app/ は jsdom
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { test: { name: "lib", environment: "node", include: ["lib/**/*.test.ts"] } },
      {
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["components/**/*.test.tsx", "app/**/*.test.tsx"],
        },
      },
    ],
  },
});
