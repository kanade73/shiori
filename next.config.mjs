/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 用。.next/standalone に最小の server.js + 依存だけを出す
  output: "standalone",
};

export default nextConfig;
