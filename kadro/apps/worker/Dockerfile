# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f apps/worker/Dockerfile .

FROM node:22.23.3-slim AS base
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@kadro/worker..."
RUN pnpm --filter "@kadro/worker..." run build
RUN pnpm --filter @kadro/worker deploy --prod /out

FROM node:22.23.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
# Ready only after the queues exist and the handlers are registered; refreshed every 30 s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "dist/healthcheck.js"]
# SIGTERM: stop fetching, wait up to 30 s for active jobs (compose stop grace period 40 s).
CMD ["node", "dist/main.js"]
