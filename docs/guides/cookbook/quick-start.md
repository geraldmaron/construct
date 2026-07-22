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

This adds `construct` to your PATH. The CLI is your single interface for setup, status, intake, orchestration, and CI/headless contracts. Prefer OpenCode as the conversational surface after adapters are synced.

---

## Step 2: Machine Setup (One-Time)

First time on a new machine, bootstrap machine-scoped config (requires an explicit footprint):

```bash
construct install --footprint=user --yes
```

A bare `construct install` with no `--footprint` hard-errors naming the flag rather than writing nothing silently.

**What this does:**
1. Creates `~/.config/construct/config.env` and seeds default model tier assignments
2. Configures the embedded LanceDB vector path and pre-warms the embedding model
3. Generates shell completions (bash + zsh)
4. Optionally installs helper CLIs (`cm`, `cass`) when Homebrew or cargo is available and you consent
5. Installs the Pressure Guard LaunchAgent on macOS (skip with `--no-launch-agent`)
6. Prints a local-services summary (traces + LanceDB path); no host ports are opened

**Traces land at** `~/.construct/projects/<key>/traces/*.jsonl` (ADR-0066). An in-project `.construct/traces/` directory is legacy heavy state flagged by `construct doctor`.

---

## Step 3: Initialize Project (Per Project)

```bash
cd ~/your-project

# Initialize and start services (services start by default)
construct init --yes

# Scaffold only — don't start services
construct init --yes --no-start

# Interactive flow with project detection
construct init --interactive
```

**What this does:**
1. Scaffolds `.construct/`, `AGENTS.md`, `plan.md`, and a minimal `docs/` index
2. Writes `construct.config.json` when missing
3. Syncs host adapters for detected editors (Claude Code, OpenCode, Codex, Copilot, Cursor, VS Code when present)
4. Starts local services by default (dashboard on an auto-selected port, memory MCP, embed daemon when configured)
5. Pass `--docs-preset=lean|product|full` or `--with-adrs` / `--with-rfcs` when you want curated doc lanes

---

## Step 4: Development (Per Session)

```bash
# Confirm health and refresh adapters after registry/prompt/config changes
construct status
construct sync

# Start services for development (if you used --no-start at init)
construct dev

# Stop services when done (optional)
construct stop
```

Talk to `@construct` in your editor. Ask for the outcome, not a Worker Profile name.

---

## Checking Status

```bash
# Full status report with credentials
construct status

# JSON output
construct status --json

# Health checks across config, services, agents, hooks, and adapters
construct doctor
```

`construct status` reports the active deployment mode, local services, and optional remote telemetry. Local traces resolve under `~/.construct/projects/<key>/traces/`; remote export is opt-in via `CONSTRUCT_TRACE_BACKEND=langfuse|http|otel`.

---

## Troubleshooting

### "construct install requires --footprint"

```bash
construct install --footprint=user --yes
# or preview without writing:
construct install --footprint=user --dry-run
```

### "Remote telemetry is unavailable"

```bash
# Local traces still work without remote export
ls ~/.construct/projects/*/traces 2>/dev/null || true

# Check configured remote export
construct status --json
```

### "Embed daemon not starting"

```bash
# Verify embed config when you use continuous embed
ls embed.yaml 2>/dev/null || true

# Start manually
construct embed start
```

### "Dashboard won't load"

```bash
construct status
construct stop
construct dev
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `construct install --footprint=user` | Machine setup (one-time) |
| `construct init` | Project initialization (per project) |
| `construct sync` | Refresh host adapters |
| `construct dev` | Start services (per session) |
| `construct stop` | Stop services |
| `construct status` | System health and credentials |
| `construct doctor` | Health check |
| `construct procedure` | List/show/invoke reusable Procedures |

---

## Related Documents

- [Install](/guides/start/install): Detailed install walkthrough
- [Deployment Model](/guides/concepts/deployment-model): Solo/team/enterprise modes
- [Worker Profile roster](/guides/concepts/org-chart): The 12 assignable profiles
- [CLI reference](/guides/reference/cli): Full command catalog
