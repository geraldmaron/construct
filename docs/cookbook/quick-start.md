---
title: Quick Start
description: Get started with Construct in 5 minutes.
---

# Quick Start

> **Standard onboarding:** Install CLI → Machine Setup → Project Init → Development

## Step 1: Install CLI (One-Time)

```bash
# Install globally (one-time, per machine)
npm install -g @geraldmaron/construct

# Verify installation
construct --version
construct doctor
```

This adds `construct` to your PATH. The CLI is your single interface for everything.

---

## Step 2: Machine Setup (One-Time)

First time on a new machine, bootstrap local services:

```bash
construct install --yes
```

**What this does:**
1. ✅ Checks Docker → offers to install if missing
2. ✅ Checks `cm` (Memory MCP server) → installs if missing
3. ✅ Checks Node.js ≥ 20 → shows download link if needed
4. ✅ Creates `~/.construct/config.env`
5. ✅ Sets up telemetry backend credentials automatically
6. ✅ Runs `construct doctor` health check

**Output:**
```
🔍 Checking prerequisites...

  ✓  Docker                    v24.0.0
  ✓  cm (Memory Server)        installed
  ✓  Node.js                   v20.11.0

✅ All prerequisites met!

Local services:
  ✓  Telemetry backend → http://localhost:54330 (credentials auto-configured)
  ✓  Postgres → postgresql://127.0.0.1:54329/construct
```

---

## Step 3: Initialize Project (Per Project)

```bash
cd ~/your-project

# Initialize + start services in one command
construct init --auto-start

# Or interactively (asks if you want to start services)
construct init
```

**What this does:**
1. ✅ Creates `.cx/` directory structure
2. ✅ Creates `construct.config.json`
3. ✅ Creates `embed.yaml` (if not exists)
4. ✅ **Starts all services** (Dashboard, Telemetry backend, Memory, Embed)
6. ✅ Opens Dashboard in browser

---

## Step 4: Development (Per Session)

```bash
# Start services for development
construct dev

# Work via Dashboard or your AI tools
# Dashboard: http://127.0.0.1:4242

# Stop services when done (optional)
construct stop
```

---

## What You Get

```
╔══════════════════════════════════════════════════════════════════════════╗
║                    Construct Runtime Started                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  ✓  Dashboard → http://127.0.0.1:4242                                    ║
║  ✓  Telemetry backend → http://localhost:54330 (Docker)                          ║
║  ✓  Memory (cm) → http://127.0.0.1:8765                                  ║
║  ✓  Embed daemon started (monitoring git, inbox, CI)                    ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Checking Status

```bash
# Full status report with credentials
construct status

# JSON output
construct status --json
```

**Output:**
```
Construct Services
══════════════════

  ✓  Dashboard                    http://127.0.0.1:4242 (Dashboard API)
  ✓  Telemetry backend            http://localhost:54330 (Trace backend)
  ✓  Memory (cm)                  http://127.0.0.1:8765 (MCP-managed)
  ✓  Embed daemon                 Running (watching git, inbox)

Telemetry Credentials (Local)
═════════════════════════════
  Dashboard:     http://localhost:54330

INFO Credentials saved to ~/.construct/config.env — edit if needed
```

---

## Troubleshooting

### "Docker not available"

```bash
# Check Docker is running
docker ps

# If not running, start Docker Desktop or:
# macOS: open -a Docker
# Linux: sudo systemctl start docker

# Then retry
construct install --yes
```

### "Telemetry backend failed to start"

```bash
# Check if port 54330 is already in use
lsof -i :54330

# Restart services
construct stop
construct dev
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
construct status

# Restart services
construct stop
construct dev

# Check for port conflicts
lsof -i :4242
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `construct install` | Machine setup: Docker, cm, config (one-time) |
| `construct init` | Project initialization (per project) |
| `construct dev` | Start services (per session) |
| `construct stop` | Stop services |
| `construct status` | System health and credentials |
| `construct doctor` | Health check |

---

## Related Documents

- [Embed Mode](/concepts/embed-mode) — How embed daemon works
- [Deployment Model](/concepts/deployment-model) — Solo/team/enterprise modes
- [Org Chart](/concepts/org-chart) — Specialist roles and departments
- [Installation](/reference/cli/install) — Detailed install guide
