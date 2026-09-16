# ホスト非依存の Dockerfile。本番は Vercel（`vercel deploy`）だが、Railway / Render / 手元の
# Docker に載せ替えたくなったとき用に残してある。状態はすべて Supabase にあるので、
# コンテナは使い捨てでよい（ボリュームは要らない）。
#
#   docker build -t misdirection-chat .
#   docker run -p 3000:3000 -e GEMINI_API_KEY=... -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... misdirection-chat

# --- deps ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.mjs はこの変数があるときだけ output: "standalone" を出す（Vercel では付けない）
ENV DOCKER_BUILD=1
# ビルダーのメモリが小さい環境で落ちないよう heap を抑える
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# standalone の server.js は public / .next/static を同梱しないので別途コピーする
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# lib/server/works.ts は process.cwd()/data から work.json を読む。トレースに乗らないので明示的に置く
COPY --from=builder --chown=nextjs:nodejs /app/data ./data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
