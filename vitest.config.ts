import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // tsconfig の paths（@/ → リポジトリ直下）を vitest でも解決する
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // lib/ と app/api/（Route Handler）は node 環境、components/ と app/ の UI は jsdom。
    // components/ でも描画を伴わない純粋関数のテスト（*.test.ts）は node 側で回す
    projects: [
      {
        test: {
          name: "lib",
          environment: "node",
          include: ["lib/**/*.test.ts", "app/api/**/*.test.ts", "components/**/*.test.ts"],
        },
      },
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
