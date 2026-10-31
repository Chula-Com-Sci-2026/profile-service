# syntax=docker/dockerfile:1

# Pinned to the minor, not floating: the image a teammate builds should be the image you built,
# and bumping it should be a commit somebody can see.
ARG NODE_IMAGE=node:24.22-alpine

# ---- build ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Dependencies first, so a source change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# --omit=dev is what keeps TypeScript, vitest, eslint and drizzle-kit out of the image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The migrations ship with the image: `node dist/migrate.js` is the same artifact, run
# differently, rather than a second thing to keep in step.
COPY drizzle ./drizzle

# /docs and /openapi.yaml serve this file, so the image needs it. Swagger UI's own assets come
# from swagger-ui-dist, which `npm ci --omit=dev` installed above because it is a dependency.
COPY docs/openapi.yaml ./docs/openapi.yaml

# The official image provides this user; nothing here needs root.
USER node

EXPOSE 3000

# Readiness, not liveness: an unhealthy container here means "do not send work", which is what
# compose's depends_on asks. Uses Node's own fetch — alpine has no curl and does not need one.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD \
  node --eval "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
