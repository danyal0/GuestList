# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/web --include-workspace-root

COPY apps/web apps/web
# API_URL is baked into the rewrite config at build time; override for prod.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm run build -w apps/web

# ---------- Runtime stage ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system gatherly && useradd --system --gid gatherly gatherly

# Next standalone output contains a minimal server + traced node_modules.
COPY --from=build --chown=gatherly:gatherly /repo/apps/web/.next/standalone ./
COPY --from=build --chown=gatherly:gatherly /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=gatherly:gatherly /repo/apps/web/public ./apps/web/public

USER gatherly
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
