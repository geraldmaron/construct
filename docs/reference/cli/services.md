---
title: Services
description: Services commands for Construct.
---

# Services

| Command | What it does |
|---|---|
| `construct beads` | Manage beads lock and queue, or run bd commands |
| `construct completions` | Generate or print shell completion scripts for construct |
| `construct down` | Stop all running services |
| `construct serve` | Start the Construct dashboard (auto-selects port) |
| `construct setup` | Bootstrap user config after npm or manual install |
| `construct show` | Show runtime service URLs and live status (compat view) |
| `construct status` | Show canonical system health across runtime and integrations |
| `construct up` | Start services (memory, dashboard) |
| `construct update` | Reinstall this checkout globally, then sync and verify hosts |

## construct beads

Manage beads lock and queue, or run bd commands

**Usage**

```bash
construct beads [status|lock-status|queue|cleanup|help]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output status as JSON |
| `--silent` | Suppress queue/lock logging when running bd commands |

## construct completions

Generate or print shell completion scripts for construct

**Usage**

```bash
construct completions [bash|zsh|install]
```

**Subcommands**

- `bash`
- `zsh`
- `install`

## construct down

Stop all running services

**Usage**

```bash
construct down
```

## construct serve

Start the Construct dashboard (auto-selects port)

**Usage**

```bash
construct serve [--token]
```

**Options**

| Flag | Description |
|---|---|
| `--token` | Generate and print a new dashboard token, then exit |

## construct setup

Bootstrap user config after npm or manual install

**Usage**

```bash
construct setup [--yes] [--no-docker]
```

**Options**

| Flag | Description |
|---|---|
| `--yes` | Apply sensible defaults without pausing for prompts |
| `--no-docker` | Skip managed local Postgres startup |

## construct config

Inspect or set the deployment posture (solo, team, enterprise). The mode persists to `~/.construct/config.env` as `CONSTRUCT_DEPLOYMENT_MODE` and drives backend selection across the intake queue, memory, telemetry, workers, and MCP broker.

**Usage**

```bash
construct config                             # show active mode + resource topology
construct config mode                        # print just the active mode
construct config mode solo|team|enterprise   # set + persist
```

**Modes**

| Mode | Use | Queue | Memory | Workers | MCP |
|---|---|---|---|---|---|
| `solo` (default) | Individual use | filesystem | local | local | direct |
| `team` | Shared team | postgres | shared | docker pool | brokered |
| `enterprise` | Hardened multi-tenant | postgres | shared (tenant-scoped) | isolated containers | brokered + signed |

See [Concepts → Deployment model](/concepts/deployment-model) for the full capability matrix.

## construct show

Show runtime service URLs and live status (compat view)

**Usage**

```bash
construct show
```

## construct status

Show canonical system health across runtime and integrations

**Usage**

```bash
construct status
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output full status payload as JSON |

## construct up

Start services (memory, dashboard)

**Usage**

```bash
construct up
```

## construct update

Reinstall this checkout globally, then sync and verify hosts

**Usage**

```bash
construct update
```
