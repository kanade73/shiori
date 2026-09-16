/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 用。.next/standalone に最小の server.js + 依存だけを出す
  output: "standalone",
  // ベクトルDB（lib/server/vector-db.ts）の sqlite-vec は、実行時にプラットフォーム別のパッケージから
  // 拡張（vec0.so など）を探して node:sqlite に読み込む。バンドルせず node_modules から読ませ、
  // standalone の出力にも拡張のファイルを入れる（動的に探すのでトレースでは拾われない）
  // kuromoji（形態素解析。lib/server/morph.ts）は辞書を node_modules/kuromoji/dict から実行時に fs で読むので、
  // 同じくバンドルせず、辞書を standalone の出力に入れる
  serverExternalPackages: ["sqlite-vec", "kuromoji"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/sqlite-vec-*/**/*", "./node_modules/kuromoji/dict/**/*"],
  },
  // dev サーバーは distDir 単位でロックファイルを持つため、同じディレクトリで
  // 複数の `next dev` を並行起動する場合は NEXT_DIST_DIR で distDir をずらす。
  // 例: NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
