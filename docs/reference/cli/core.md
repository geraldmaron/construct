---
title: Core
description: Core commands for Construct.
---

# Core

| Command | What it does |
|---|---|
| `construct dashboard` | Start the local dashboard/orchestration daemon (or --token to mint a dashboard token) |
| `construct dev` | Start services for development |
| `construct docs` | Documentation commands |
| `construct doctor` | Check installation health |
| `construct init` | Project setup (once per repo): scaffold .cx/, AGENTS.md, plan.md, adapters |
| `construct install` | Machine setup (scoped per ADR-0029): --scope=project\|user\|both, default project |
| `construct intake` | View and process the active profile's intake queue (queue label varies by profile) |
| `construct profile` | Manage the active org profile and its lifecycle (draft, promote, archive, health) |
| `construct recommendations` | View and manage artifact recommendations |
| `construct sandbox` | Isolated tmpdir-based environment for QA / specialist dry-runs |
| `construct status` | Show system health and credentials |
| `construct stop` | Stop all running services |
| `construct sync` | Sync agent adapters to AI tools |

## construct dashboard

Start the local dashboard/orchestration daemon (or --token to mint a dashboard token)

**Usage**

```bash
construct dashboard [--token]
```

## construct dev

Start services for development

**Usage**

```bash
construct dev [--select] [--only=postgres,dashboard,...]
```

**Options**

| Flag | Description |
|---|---|
| `--select` | Pick which services to start from an interactive checklist |
| `--only=<a,b,c>` | Start only the named services (postgres, dashboard, telemetry, memory, opencode) |

## construct docs

Documentation commands

**Usage**

```bash
construct docs check|verify|update
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct doctor

Check installation health

**Usage**

```bash
construct doctor [<status|logs|tick|report|consistency|watch|stop|credentials>] [--fix-legacy-agents]
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

**Options**

| Flag | Description |
|---|---|
| `--fix-legacy-agents` | Sweep legacy cx-*.md agents at user scope and re-sync |

## construct init

Project setup (once per repo): scaffold .cx/, AGENTS.md, plan.md, adapters

**Usage**

```bash
construct init [path] [options]
```

**Options**

| Flag | Description |
|---|---|
| `--yes` | Accept all defaults (non-interactive) |
| `--no-start` | Do not start services after init |
| `--commit-bootstrap` | Keep the beads bootstrap commit (default: leave files uncommitted) |
| `--with-<host>` | Force an adapter set (claude|codex|opencode|vscode|cursor|copilot); default writes detected hosts only |
| `--all-hosts` | Write every adapter set regardless of what is installed |
| `--interactive, -i` | Enable interactive setup with project detection |
| `--quiet, -q` | Minimal output |
| `--verbose, -v` | Detailed output |
| `--with-docs=adrs,rfcs` | Enable specific doc lanes (comma-separated) |
| `--with-all-docs` | Enable all documentation lanes |
| `--with-adrs` | Enable Architecture Decision Records |
| `--with-rfcs` | Enable RFCs (design reviews) |
| `--with-runbooks` | Enable operational runbooks |
| `--with-postmortems` | Enable incident postmortems |
| `--with-architecture` | Create architecture.md |

## construct install

Machine setup (scoped per ADR-0029): --scope=project|user|both, default project

**Usage**

```bash
construct install [--scope=project|user|both] [--yes] [--no-docker] [--reconfigure]
```

**Options**

| Flag | Description |
|---|---|
| `--scope=<s>` | project (default, no-op + guidance) | user (writes ~/.construct/, MCP, ~/.claude/* via consent) | both |
| `--yes` | Apply defaults without prompts (only meaningful with --scope=user|both) |
| `--no-docker` | Skip Docker-based service setup (local Postgres) |
| `--reconfigure` | Re-prompt for service consent, ignoring cached answers |

## construct intake

View and process the active profile's intake queue (queue label varies by profile)

**Usage**

```bash
construct intake list|show|done|skip|reopen|integrate|classify
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct profile

Manage the active org profile and its lifecycle (draft, promote, archive, health)

**Usage**

```bash
construct profile show|list|set|create|drafts|archive|health
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct recommendations

View and manage artifact recommendations

**Usage**

```bash
construct recommendations list|show|dismiss|stats
```

## construct sandbox

Isolated tmpdir-based environment for QA / specialist dry-runs

**Usage**

```bash
construct sandbox create|list|delete|prune [--profile=<id>]
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct status

Show system health and credentials

**Usage**

```bash
construct status
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output full status payload as JSON |

## construct stop

Stop all running services

**Usage**

```bash
construct stop
```

## construct sync

Sync agent adapters to AI tools

**Usage**

```bash
construct sync [--project] [--dry-run] [--no-docs] [--compress-personas]
```

**Options**

| Flag | Description |
|---|---|
| `--project` | Write project-local Claude adapters into the current repo only |
| `--dry-run` | Preview adapter changes without writing files |
| `--no-docs` | Skip AUTO docs regeneration after syncing adapters |
| `--compress-personas` | Write compressed runtime persona prompts without changing the source prompts |
