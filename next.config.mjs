/** @type {import('next').NextConfig} */
const nextConfig = {
  // lib/server/works.ts は process.cwd()/data から work.json を読む。動的なパスなので
  // トレースに乗らない。Vercel の関数に data/ を同梱させるために明示する
  // （これが無いと本番で作品が1つも見つからない）
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*.json"],
  },
  // Docker で動かすときだけ .next/standalone を出す（Dockerfile は DOCKER_BUILD=1 でビルドする）。
  // Vercel は自前で関数を組むので、既定では付けない
  ...(process.env.DOCKER_BUILD ? { output: "standalone" } : {}),
  // dev サーバーは distDir 単位でロックファイルを持つため、同じディレクトリで
  // 複数の `next dev` を並行起動する場合は NEXT_DIST_DIR で distDir をずらす。
  // 例: NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
