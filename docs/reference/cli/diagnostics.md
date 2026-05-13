---
title: Diagnostics
description: Diagnostics commands for Construct.
---

# Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct backup` | Create, verify, restore, list, or prune full system backups (observations, sessions, config, registry, Postgres). |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct diff` | Show which agents changed prompts or settings since HEAD |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct doctor` | Run installation health checks (default), or manage the L0 doctor daemon |
| `construct gates:audit` | Audit policy gates across CI, local hooks, and branch protection; flag gaps |
| `construct skills` | Detect project tech stack and scope installed skills to relevance |
| `construct validate` | Validate registry.json structure and field constraints |
| `construct version` | Show version |

## construct audit

Audit Construct internals and review the mutation trail

**Usage**

```bash
construct audit <skills|trail>
```

**Subcommands**

- `[object Object]`
- `[object Object]`

## construct backup

Create, verify, restore, list, or prune full system backups (observations, sessions, config, registry, Postgres).

**Usage**

```bash
construct backup <create|verify|restore|list|prune> [--include-secrets] [--yes] [--keep=N] [--no-prune]
```

## construct cleanup

Release dev-agent memory pressure by cleaning stale helper and bridge processes

**Usage**

```bash
construct cleanup [--pressure-release] [--quiet]
```

**Options**

| Flag | Description |
|---|---|
| `--pressure-release` | Also terminate stale cass index processes when swap is above threshold |
| `--quiet` | Suppress per-process output and only act on the current policy |

## construct diff

Show which agents changed prompts or settings since HEAD

**Usage**

```bash
construct diff
```

## construct doc

Verify or inspect auditability stamps on Construct-generated markdown files

**Usage**

```bash
construct doc <verify|install-hooks> [path] [--json]
```

**Subcommands**

- `[object Object]`
- `[object Object]`

## construct doctor

Run installation health checks (default), or manage the L0 doctor daemon

**Usage**

```bash
construct doctor [check|status|watch|stop|logs|tick]
```

**Options**

| Flag | Description |
|---|---|
| `--watcher=NAME` | Filter audit log by watcher name (logs) |
| `--limit=N` | Limit number of entries returned (logs) |

## construct gates:audit

Audit policy gates across CI, local hooks, and branch protection; flag gaps

**Usage**

```bash
construct gates:audit [--json]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Emit structured JSON report |

## construct skills

Detect project tech stack and scope installed skills to relevance

**Usage**

```bash
construct skills <scope|apply>
```

**Subcommands**

- `[object Object]`
- `[object Object]`

## construct validate

Validate registry.json structure and field constraints

**Usage**

```bash
construct validate
```

## construct version

Show version

**Usage**

```bash
construct version
```
