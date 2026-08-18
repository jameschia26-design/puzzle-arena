# syntax=docker/dockerfile:1

# ---------- stage 1: build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/puzzles/package.json packages/puzzles/
COPY packages/games/package.json packages/games/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# --include=dev is load-bearing: the build needs typescript and vite, and some
# platforms (Zeabur among them) inject the service's NODE_ENV=production into
# the build stage, which would otherwise make `npm ci` omit devDependencies and
# fail with "tsc: not found".
RUN npm ci --include=dev

COPY . .
# tsc -b builds the packages and the server; then Vite builds the SPA.
RUN npm run build

# Production dependencies only, for the runtime image.
RUN npm prune --omit=dev

# ---------- stage 2: runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Workspace packages: manifests + built output (npm ci created symlinks in
# node_modules that point at these paths).
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/puzzles/package.json ./packages/puzzles/
COPY --from=build /app/packages/puzzles/dist ./packages/puzzles/dist
COPY --from=build /app/packages/games/package.json ./packages/games/
COPY --from=build /app/packages/games/dist ./packages/games/dist

COPY --from=build /app/apps/server/package.json ./apps/server/
# npm workspaces does not hoist everything — better-auth and nanoid resolve to
# apps/server/node_modules, so the root node_modules alone is not enough.
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
# Migrations run on boot, so they must ship with the image.
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle

COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
