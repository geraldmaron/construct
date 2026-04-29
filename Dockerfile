# syntax=docker/dockerfile:1
# ── Construct — single-container image ────────────────────────────────────
#
# Build:  docker build -t construct .
# Run:    docker run -p 4242:4242 \
#           -e CONSTRUCT_DASHBOARD_TOKEN=<token> \
#           -v construct-data:/data \
#           construct
#
# Target: <500 MB. Uses node:22-alpine (slim base).
# The claude CLI is installed at build time from npm so the dashboard
# chat feature works without a host-level install.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base

# Install runtime dependencies only
# git is required by the git provider (shells out to git CLI)
# curl is used by health checks
RUN apk add --no-cache git curl bash

WORKDIR /app

# ── Dependencies ───────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json package-lock.json ./

# Install production deps only; skip optional/dev.
# --ignore-scripts avoids running postinstall hooks that assume a full env.
RUN npm ci --omit=dev --ignore-scripts

# Install the claude CLI globally so dashboard chat works
RUN npm install -g @anthropic-ai/claude-code --ignore-scripts 2>/dev/null || true

# ── Application ────────────────────────────────────────────────────────────
FROM base AS app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=deps /usr/local/bin/claude* /usr/local/bin/

# Copy source (honour .dockerignore for node_modules, .git, secrets)
COPY . .

# ── Runtime configuration ──────────────────────────────────────────────────
# All state is written under /data so it can be backed by a named volume
# or a cloud-mounted filesystem in production.
ENV HOME=/data
ENV PORT=4242
ENV NODE_ENV=production

# Ensure the construct config dir exists under /data
RUN mkdir -p /data/.construct /data/.cx

# Expose dashboard port
EXPOSE 4242

# Health check — hits the public auth status endpoint (no token required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://localhost:4242/api/auth/status | grep -q "configured" || exit 1

# Run as non-root
RUN addgroup -S construct && adduser -S -G construct construct \
    && chown -R construct:construct /app /data
USER construct

# Entry point — start the dashboard server directly
# The server binds to 0.0.0.0 in container mode (PORT env controls port)
CMD ["node", "lib/server/index.mjs"]
