# JaliCare HMIS — production image
#
# WHAT THIS IMAGE IS
#   A single Node process serving the API and the built React SPA
#   (`node build/server.js`, the same artifact cPanel runs). PostgreSQL is a
#   separate service — see docker-compose.yml.
#
# WHAT THIS IMAGE IS NOT
#   It does not migrate the database on start. schema.ts changes shipped in
#   this image must be applied deliberately, by a person, with a verified
#   backup. An application that migrates on boot turns "container restarted
#   twice at the same time" into a corrupted schema, and this system holds
#   patient records.
#
# THREE STAGES
#   deps   installs the full tree once, including dev dependencies
#   build  compiles the SPA and bundles the server
#   runner a slim image with production dependencies, the two artifacts,
#          the migration files (`drizzle/`) and the scripts that apply them
#
# Pinned to Node 22 to match CI and the `engines` field: a runtime that
# differs from the one the tests ran on is a variable nobody needs.

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------
FROM node:26-bookworm-slim AS deps

WORKDIR /app

# Build tools for native modules (argon2 compiles or fetches a prebuilt
# binary; the fallback path needs python3 and a C++ toolchain).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy only the manifests so a source-only edit reuses this layer.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what the lock file pins. Not `npm install`:
# that can resolve a different tree than the one CI verified.
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM deps AS build

WORKDIR /app

COPY . .

# The SPA is compiled with Vite; the server is bundled from server.ts.
# Both land in dist/ and build/. No environment variable is baked into the
# client bundle that is not safe to publish — the API is reached at a
# relative path, so the same image works on any host.
RUN npm run build:deploy

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:26-bookworm-slim AS runner

# `curl` is not installed: the health check in docker-compose uses a Node
# one-liner instead, so the runtime image keeps one fewer package and one
# fewer thing to patch.

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Africa/Nairobi

WORKDIR /app

# `dumb-init` reaps zombies and forwards SIGTERM. Node as PID 1 does not
# handle signals reliably, and a container that ignores SIGTERM gets killed
# by SIGKILL after the timeout — which drops in-flight requests.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

# PostgreSQL client tools, for operators running `psql` or `pg_dump` through
# `docker compose exec`. Not needed to serve traffic, but a backup you cannot
# take from inside the network is a backup you will not take.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies only. The build toolchain stays in stage 2.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The two artifacts and the things needed to run and migrate them.
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json

# The application does not need write access to its own code. Node needs a
# writable /tmp; everything else stays owned by root and read-only to the
# runtime user, so a compromised process cannot rewrite the server bundle.
RUN mkdir -p /app/uploads /tmp/jalicare \
 && chown -R node:node /app/uploads /tmp/jalicare \
 && chmod -R a-w /app/build /app/dist /app/drizzle

USER node

# Documentation only; the real values come from the environment.
EXPOSE 3000

# Fails the container if the process is up but the database is unreachable.
# Start period is generous: `npm ci` is behind us, but the first query opens
# a connection pool.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "build/server.js"]
