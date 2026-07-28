# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install workspace dependencies with layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/api --include-workspace-root

COPY apps/api apps/api
RUN npm run prisma:generate -w apps/api \
  && npm run build -w apps/api \
  && npm prune --omit=dev --workspace apps/api --include-workspace-root \
  # Re-generate after pruning: npm prune can remove the generated .prisma client.
  && npm run prisma:generate -w apps/api

# ---------- Runtime stage ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/* \
  && groupadd --system mkeplays && useradd --system --gid mkeplays mkeplays

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/scripts ./apps/api/scripts

# Writable uploads dir (mount a volume in production).
RUN mkdir -p /app/apps/api/uploads && chown -R mkeplays:mkeplays /app

USER mkeplays
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -sf http://localhost:4000/api/v1/health || exit 1

# Prefer start-prod (resolves dist/main.js vs dist/src/main.js; skips migrate in file mode).
CMD ["node", "scripts/start-prod.cjs"]
