/** @type {import('next').NextConfig} */
const nextConfig = {
  // dev サーバーは distDir 単位でロックファイルを持つため、同じディレクトリで
  // 複数の `next dev` を並行起動する場合は NEXT_DIST_DIR で distDir をずらす。
  // 例: NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
