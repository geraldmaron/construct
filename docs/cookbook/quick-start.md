---
title: Quick Start
description: Single command to start everything — services, dashboard, and embed daemon.
---

# Quick Start

> **One command to start everything:** `construct up` or `construct start`

## Single Startup Command

```bash
# Start ALL services (dashboard, Langfuse, memory, embed daemon)
construct up

# Or use the alias
construct start
```

**What this does:**

1. ✅ Starts **Dashboard** → http://127.0.0.1:4242
2. ✅ Starts **Local Langfuse** (Docker) → http://localhost:54330
3. ✅ Starts **Memory Server** (cm) → http://127.0.0.1:8765
4. ✅ Starts **Embed Daemon** (if `embed.yaml` exists + `autoEmbed: true`)
5. ✅ Checks **Docker** availability
6. ✅ Verifies **Langfuse credentials**

## What You Get

```
╔══════════════════════════════════════════════════════════════════════════╗
║                    Construct Runtime Started                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  ✓  Dashboard → http://127.0.0.1:4242                                    ║
║  ✓  Langfuse → http://localhost:54330 (Docker)                          ║
║  ✓  Memory (cm) → http://127.0.0.1:8765                                  ║
║  ✓  Embed daemon started (monitoring git, inbox, CI)                    ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Prerequisites

### 1. Langfuse Credentials (Required for telemetry)

Add to `~/.construct/.env`:

```bash
CONSTRUCT_LANGFUSE_BASE_URL=http://localhost:54330
CONSTRUCT_LANGFUSE_PUBLIC_KEY=langfuse-public-key
CONSTRUCT_LANGFUSE_SECRET_KEY=langfuse-secret-key
```

**Get credentials from local Langfuse:**
```bash
# After running `construct up` once, open:
open http://localhost:54330

# Go to Settings → API Keys
# Copy public and secret keys to ~/.construct/.env
```

### 2. Docker (for Langfuse + Postgres)

```bash
# Check Docker is running
docker ps

# If not running, start Docker Desktop or:
# macOS: open -a Docker
# Linux: sudo systemctl start docker
```

### 3. Embed Configuration (Optional but Recommended)

Create `embed.yaml` at project root:

```yaml
version: 1
project: construct

sources:
  - type: filesystem
    path: .cx/inbox/
    watch: true
  - type: git
    watch: true
    events: [push, merge]

roles:
  primary: architect
  secondary: product-manager
```

## Stopping Everything

```bash
# Stop all services
construct down

# Or use the alias
construct stop
```

## Checking Status

```bash
# Full status report
construct status

# Quick service check
construct show
```

**Output:**
```
Construct Services
══════════════════

  • Managed dashboard PID 6014 on http://127.0.0.1:4242
  ✓  Dashboard                    http://127.0.0.1:4242 (Dashboard API)
  ✓  Langfuse                     http://localhost:54330 (Trace backend)
  ✓  Memory (cm)                  http://127.0.0.1:8765 (MCP-managed)
  ✓  Embed daemon                 Running (watching git, inbox)
```

## Troubleshooting

### "Langfuse failed to start"

```bash
# Check Docker is running
docker ps

# Check if port 54330 is already in use
lsof -i :54330

# Restart Langfuse
construct down
construct up
```

### "Embed daemon not starting"

Check `embed.yaml` exists and `autoEmbed` is enabled:

```bash
# Verify embed.yaml
ls embed.yaml

# Check config
cat construct.config.json | grep autoEmbed

# Start manually
construct embed start
```

### "Dashboard won't load"

```bash
# Check if dashboard is running
construct show

# Restart dashboard
construct down
construct up

# Check for port conflicts
lsof -i :4242
```

## Dogfooding: Running Construct on Itself

This project (`construct`) is configured to dogfood itself:

```bash
# Start everything for Construct development
cd /path/to/construct
construct up

# Verify embed is watching
construct embed status

# Drop a signal in the inbox
echo "# Test signal" > .cx/inbox/test.md

# Watch it get classified
construct intake list
```

**What gets monitored:**
- `.cx/inbox/` — Manual signal drops
- Git commits, pushes, merges
- GitHub Actions CI failures
- Scheduled activations (stale docs, CVE review, trace review)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  construct up / start                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Dashboard (HTTP server)                                 │
│     └─→ http://127.0.0.1:4242                              │
│                                                              │
│  2. Langfuse (Docker)                                       │
│     └─→ http://localhost:54330                             │
│     └─→ Telemetry backend (traces, evals, costs)           │
│                                                              │
│  3. Memory Server (cm)                                      │
│     └─→ http://127.0.0.1:8765                              │
│     └─→ Cross-session recall, observations                 │
│                                                              │
│  4. Embed Daemon (if embed.yaml + autoEmbed)               │
│     └─→ Watches git, inbox, CI                             │
│     └─→ Scheduled activations (docs, security, traces)     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Related Documents

- [Embed Mode](/concepts/embed-mode) — How embed daemon works
- [Deployment Model](/concepts/deployment-model) — Solo/team/enterprise modes
- [Org Chart](/concepts/org-chart) — Specialist roles and departments
- [Prompt Audit](/audit/prompt-audit-20260519) — 2026 best practices analysis
