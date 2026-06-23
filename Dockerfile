# syntax=docker/dockerfile:1
# ── Construct — multi-stage hardened image ────────────────────────────────
#
# Build:  docker build -t construct .
# Run:    docker run --read-only --tmpfs /tmp \
#           -p 4242:4242 \
#           -e CONSTRUCT_DASHBOARD_TOKEN=<token> \
#           -v construct-data:/data \
#           construct
#
# Stages:
#   builder  — full build environment (npm ci, global tools)
#   runtime  — minimal runtime (node + git + curl, no bash, no shell)
#
# The git binary stays in the runtime image because the GitHub provider
# shells out to git CLI. bash is intentionally absent.

ARG NODE_VERSION=22

# ── Builder ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

# Upgrade npm before any install step.  The npm version shipped in the base
# image (10.x) bundles picomatch 4.0.3 (CVE-2026-33671, ReDoS).  npm 11+
# no longer bundles picomatch at all — upgrading eliminates the vulnerability
# from the image rather than suppressing it.  Patch npm's bundled undici to
# 6.27.0+ (CVE-2026-12151) so the release Trivy gate passes.
RUN npm install -g npm@latest --silent \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici \
           /usr/local/lib/node_modules/npm/node_modules/node_modules \
  && cd /tmp \
  && npm pack undici@6.27.0 \
  && tar -xzf undici-6.27.0.tgz \
  && mv package /usr/local/lib/node_modules/npm/node_modules/undici \
  && rm -f undici-6.27.0.tgz

COPY package.json package-lock.json ./

# Production deps only. --ignore-scripts skips the postinstall hook which
# requires the full source tree (not yet copied at this stage).
RUN npm ci --omit=dev --ignore-scripts

# Install the claude CLI globally for dashboard chat
RUN npm install -g @anthropic-ai/claude-code 2>/dev/null || true

# Copy application source
COPY . .

# ── Runtime ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime

# git: required by the git provider (shells out to git CLI)
# curl: required by HEALTHCHECK
# No bash — use sh for any internal scripts
RUN apk add --no-cache git curl \
    && addgroup -S construct \
    && adduser -S -G construct construct

WORKDIR /app

# Copy only what runtime needs from builder.
# rm -rf first: the base image ships npm 10.x (with vulnerable picomatch 4.0.3).
# Docker COPY merges into existing directories — without the rm, the base layer's
# old npm/node_modules/picomatch persists through overlayfs even when the builder's
# upgraded npm no longer bundles it.
RUN rm -rf /usr/local/lib/node_modules
COPY --from=builder /build/node_modules        ./node_modules
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=builder /usr/local/bin/claude*     /usr/local/bin/

# Application source (no build artifacts, no .git, no secrets — see .dockerignore)
COPY --chown=construct:construct . .

# Pre-create state directories so /data volume mount works without root
RUN mkdir -p /data/.construct /data/.cx \
    && chown -R construct:construct /data

ENV HOME=/data \
    PORT=4242 \
    NODE_ENV=production \
    CX_DATA_DIR=/data

EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://localhost:4242/api/auth/status || exit 1

USER construct

CMD ["node", "lib/server/index.mjs"]
