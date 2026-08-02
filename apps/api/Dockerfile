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
# openssl: without it Prisma cannot detect the TLS library on Alpine and warns
# "failed to detect the libssl/openssl version ... Defaulting to openssl-1.1.x",
# then picks an engine that can mismatch Alpine's OpenSSL 3.x at runtime.
RUN corepack enable && apk add --no-cache python3 make g++ openssl

# ── Install all dependencies ──────────────────────────────────────────────────
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/resume-template/package.json ./packages/resume-template/
COPY apps/api/package.json ./apps/api/
# The Prisma schema MUST be present before `pnpm install`, because apps/api's
# postinstall hook runs `prisma generate` and would otherwise fail with
# "Could not find Prisma Schema". Copying it here (rather than disabling the
# hook) keeps generation automatic in every environment — local, CI, and image.
# It is copied separately from the source tree so the dependency layer stays
# cacheable: it only invalidates when the schema itself changes.
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --frozen-lockfile

# ── Build packages then the API app ──────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
# Source FIRST, then the installed node_modules — never the other way round.
# `COPY . .` copies whatever the build context contains, and a context uploaded
# from a developer machine (docker build / fly deploy / railway up) can still
# carry nested node_modules if .dockerignore is ever weakened. Copying deps
# last means the deps stage always wins instead of being silently clobbered by
# host symlinks that dangle inside the container.
COPY . .
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/shared-config/node_modules ./packages/shared-config/node_modules
COPY --from=deps /repo/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
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
# `pnpm deploy --prod` rebuilds node_modules from the store, so the Prisma client
# generated back in the deps stage does NOT survive into /deploy — and `prisma`
# is a devDependency, so --prod strips the CLI and the postinstall hook cannot
# regenerate it there either. The result is a pristine, ungenerated client whose
# enum exports are all undefined, and the process dies at module-load on the
# first `@IsEnum(SomePrismaEnum)` it evaluates:
#   TypeError: Cannot convert undefined or null to object   (validEnumValues)
# Generate explicitly, using the CLI that still exists in the builder tree. The
# schema must be the one INSIDE /deploy: Prisma resolves which @prisma/client to
# write into by walking up from the schema's directory.
RUN test -f /deploy/prisma/schema.prisma \
 && cd /deploy \
 && /repo/apps/api/node_modules/.bin/prisma generate --schema=/deploy/prisma/schema.prisma
# Fail the BUILD rather than shipping an image that crash-loops at runtime.
RUN cd /deploy && node -e "const c=require('@prisma/client'); if(!c.AuditStatus) throw new Error('Prisma client is not generated — enum exports are undefined'); console.log('prisma client OK');"

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
#   openssl             Prisma's query engine links against it at RUNTIME; the
#                       node:22-alpine base does not ship it, and without it the
#                       engine can fail to load even though generation succeeded
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont openssl
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs
COPY --from=deployer --chown=nestjs:nodejs /deploy ./
COPY --from=builder  --chown=nestjs:nodejs /repo/apps/api/dist ./dist
# One image serves BOTH processes, so a missing entrypoint surfaces only as a
# crash loop in whichever service overrides the CMD — and only for that service.
# Assert both at build time.
RUN test -f ./dist/main.api.js && test -f ./dist/main.worker.js
USER nestjs
EXPOSE 3001
# Override CMD in Railway worker service: node dist/main.worker.js
CMD ["node", "dist/main.api.js"]
