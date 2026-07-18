# Multi-stage build for the NestJS API + Worker.
# Build context: repository root (docker build -f apps/api/Dockerfile .)
#
# Deploy two Railway services from this one image:
#   API:    CMD ["node", "dist/main.api.js"]    (default)
#   Worker: CMD ["node", "dist/main.worker.js"] (override in Railway service settings)

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# S7-B1: puppeteer must NOT download its own ~170MB Chrome inside the image —
# the runtime stage installs Alpine's chromium package instead (see runner).
ENV PUPPETEER_SKIP_DOWNLOAD=true
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
# S7-B1: Chromium runtime for the WORKER's PDF rendering (Puppeteer). The
# binary ships in BOTH services' image (one image, two CMDs) but ONLY the
# worker process ever launches it — the API never imports the pool.
#   chromium            the browser itself (Alpine build)
#   nss                 certificate/security libs Chromium links against
#   freetype/harfbuzz   font rasterization + shaping
#   ca-certificates     TLS roots (Chromium refuses to start sanely without)
#   ttf-freefont        a real Latin font so text actually renders (EN MVP;
#                       Devanagari/Arabic fonts are added with HI/AR in Phase 2)
# The app finds it via CHROMIUM_EXECUTABLE_PATH (set below) because the npm
# install skipped puppeteer's bundled download (PUPPETEER_SKIP_DOWNLOAD).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs
COPY --from=deployer --chown=nestjs:nodejs /deploy ./
COPY --from=builder  --chown=nestjs:nodejs /repo/apps/api/dist ./dist
USER nestjs
EXPOSE 3001
# Override CMD in Railway worker service: node dist/main.worker.js
CMD ["node", "dist/main.api.js"]
