# Multi-stage build for the NestJS API + Worker.
# Build context: repository root (docker build -f apps/api/Dockerfile .)
#
# Deploy two Railway services from this one image:
#   API:    CMD ["node", "dist/main.api.js"]    (default)
#   Worker: CMD ["node", "dist/main.worker.js"] (override in Railway service settings)

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# python3 + make + g++ are required for argon2's native bindings (node-gyp).
RUN corepack enable && apk add --no-cache python3 make g++

# ── Install all dependencies ──────────────────────────────────────────────────
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/resume-template/package.json ./packages/resume-template/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# ── Build packages then the API app ──────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/shared-config/node_modules ./packages/shared-config/node_modules
COPY --from=deps /repo/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY . .
# Compile shared packages first so their dist/ is available at runtime.
RUN pnpm --filter @skillindiaconnect/shared-config build
RUN pnpm --filter @skillindiaconnect/shared-types build
# Build both entrypoints (main.api + main.worker end up in dist/).
RUN pnpm --filter @skillindiaconnect/api build

# ── Create standalone deployment folder via pnpm deploy ───────────────────────
FROM base AS deployer
WORKDIR /repo
COPY --from=builder /repo .
RUN pnpm deploy --filter @skillindiaconnect/api --prod /deploy

# ── Slim runtime image ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs
COPY --from=deployer --chown=nestjs:nodejs /deploy ./
COPY --from=builder  --chown=nestjs:nodejs /repo/apps/api/dist ./dist
USER nestjs
EXPOSE 3001
# Override CMD in Railway worker service: node dist/main.worker.js
CMD ["node", "dist/main.api.js"]
