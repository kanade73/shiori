# ホスト非依存の Dockerfile。Fly.io を既定にしているが Railway / Render でもそのまま動く。
# Next.js の output: "standalone" を使い、node_modules を丸ごと持ち込まない。
# ベースは glibc の Debian（slim）。ベクトルDB の sqlite-vec が配布している Linux 版の拡張は glibc 向けで、
# alpine（musl）では読み込めない。node:sqlite の拡張読み込み（allowExtension）は Node 22.13 以降

# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# ビルダーのメモリが小さい環境（Fly の remote builder やローカルの Docker VM）で落ちないよう heap を抑える
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# lib/server/store.ts はここに db.json を、lib/server/vector-db.ts は vectors/ を書く。コンテナでは同じパスにボリュームを当てる
ENV DATA_DIR=/app/.data

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /app/.data \
 && chown nextjs:nodejs /app/.data

# standalone の server.js は public / .next/static を同梱しないので別途コピーする
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# lib/server/works.ts は process.cwd()/data から work.json を読む。トレースに乗らないので明示的に置く
COPY --from=builder --chown=nextjs:nodejs /app/data ./data

USER nextjs
EXPOSE 3000
VOLUME ["/app/.data"]

CMD ["node", "server.js"]
