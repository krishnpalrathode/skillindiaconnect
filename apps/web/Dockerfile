# Multi-stage build for the Next.js 14 web app.
# Build context: repository root (docker build -f apps/web/Dockerfile .)

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Install all dependencies ──────────────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @skillindiaconnect/web build

# ── Create standalone deployment folder via pnpm deploy ──────────────────────
FROM base AS deployer
WORKDIR /repo
COPY --from=builder /repo .
RUN pnpm deploy --filter @skillindiaconnect/web --prod /deploy

# ── Slim runtime image ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs
COPY --from=deployer --chown=nextjs:nodejs /deploy ./
COPY --from=builder  --chown=nextjs:nodejs /repo/apps/web/.next ./.next
USER nextjs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
