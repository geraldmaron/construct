<!--
skills/devops/containerization.md — Containerization — Use this skill when writing Dockerfiles, optimizing image size, or securing cont

Use this skill when writing Dockerfiles, optimizing image size, or securing container builds. ## Multi-Stage Builds
-->
# Containerization

Use this skill when writing Dockerfiles, optimizing image size, or securing container builds.

## Multi-Stage Builds

Use a builder stage to compile and a minimal runtime stage to ship only what is needed:

```dockerfile
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
```

Runtime base image selection:
- `gcr.io/distroless/nodejs20-debian12` — no shell, no package manager, smallest attack surface for Node.
- `node:20-alpine` — shell available for debugging; use when distroless breaks scripts.
- `scratch` — static binaries only (Go, Rust with `musl`).
- Never use `debian`, `ubuntu`, or `node:20` (Debian-based) as a production runtime base; they carry thousands of unnecessary packages.

## Layer Caching

Order layers by change frequency — least-changed first:

1. Base OS packages (`RUN apk add ...`)
2. App dependencies (`COPY package*.json ./` then `RUN npm ci`)
3. Source code (`COPY . .`)
4. Build output (`RUN npm run build`)

Always `COPY package*.json ./` before `COPY . .`. A source change must not invalidate the dependency layer.

Use BuildKit mount caches to avoid re-downloading packages across builds:
```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
```

Combine related `RUN` commands and clean package manager caches in the same layer:
```dockerfile
RUN apk add --no-cache curl git && \
    rm -rf /var/cache/apk/*
```

Never put cache cleanup in a separate `RUN` — it creates a new layer that does not reclaim space from the previous layer.

## Security

| Practice | Implementation |
|---|---|
| Non-root user | `RUN addgroup -S app && adduser -S app -G app` then `USER app` before CMD |
| No secrets in layers | Use `--secret` mount at build time or runtime env injection; never `ENV SECRET=` or `ARG TOKEN=` |
| Minimal base | distroless by default; alpine when a shell is needed; never debian/ubuntu for production |
| Pinned base digest | `FROM node:20-alpine@sha256:<digest>` prevents silent upstream changes |
| No `apt-get upgrade` | Pin the base image digest instead; `upgrade` produces non-reproducible layers |
| Read-only filesystem | Pass `--read-only` at runtime; mount writable tmpfs only for paths that need writes |

Never use `ADD` with a URL — it bypasses layer caching in unpredictable ways and cannot be verified. Use `COPY` for local files and `curl` + checksum verification for remote files.

## Image Scanning

| Tool | Integration | Default Threshold |
|---|---|---|
| Trivy | `aquasecurity/trivy-action` GitHub Action; `trivy image <name>` CLI | Fail CI on CRITICAL; warn on HIGH |
| Snyk | `snyk container test <image>`; Snyk Container GitHub Action | Fail on CRITICAL/HIGH; surface fixability data |
| Docker Scout | `docker scout cves <image>`; built into Docker Desktop | Advisory; set `--exit-code` flag for CI enforcement |

Run image scanning in CI after the build stage, before the deploy stage. Scan the exact image SHA that will be deployed, not a rebuilt copy.

## .dockerignore

Always include a `.dockerignore`. Exclude: `.git`, `node_modules`, `.env`, `*.env`, `test/`, `tests/`, `docs/`, `*.md`, `coverage/`, `*.log`, `dist/` (only if rebuilding inside the container).

A missing `.dockerignore` sends the entire repo context to the daemon on every build, including secrets and `.git` history.

## Health Checks

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

Use an HTTP endpoint for web services. Use a process check (`pgrep`) only for non-HTTP workloads.

Kubernetes uses separate liveness, readiness, and startup probes — configure those in the deployment manifest, not in the Dockerfile. The Docker `HEALTHCHECK` is relevant for `docker run` and Docker Compose only.

## Size Optimization

- Use `dive <image>` to inspect layer sizes and identify waste before shipping.
- `--no-install-recommends` with `apt-get install` eliminates suggested packages.
- Always clean package manager caches in the same `RUN` layer as the install command.
- Use `COPY --chown=app:app` instead of a separate `RUN chown` to avoid a wasted layer.
- Multi-stage builds remove all build tools, source files, and intermediate artifacts automatically — they are the single highest-impact size reduction technique.
- For Go and Rust, build a statically linked binary (`CGO_ENABLED=0` for Go, `musl` target for Rust) and copy it into `scratch` or distroless for a final image under 20 MB.
