---
title: Advanced
description: Advanced commands for Construct.
---

# Advanced

| Command | What it does |
|---|---|
| `construct auth:status` | Check auth status |
| `construct backup` | System backups |
| `construct beads` | Task queue management |
| `construct beads:stats` | Show beads counters and drift summary |
| `construct ci` | Local CI mirror: run CI jobs locally or view recent run status |
| `construct completions` | Shell completion scripts |
| `construct config` | Deployment mode configuration |
| `construct diff` | Show agent changes since HEAD |
| `construct embed` | Embed mode management |
| `construct gates:audit` | Audit policy gates |
| `construct hooks:health` | Check hook health |
| `construct list` | List all agents |
| `construct policy` | Show active policy gates with enforcement details |
| `construct provider` | Provider management |
| `construct role` | Role framework management |
| `construct roles:list` | List installed role contracts |
| `construct roles:set` | Activate a role contract |
| `construct scheduler` | Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup) |
| `construct skills` | Skill relevance detection |
| `construct uninstall` | Remove Construct state |
| `construct update` | Reinstall this checkout |
| `construct upgrade` | Upgrade to latest npm version |
| `construct validate` | Validate registry structure |
| `construct version` | Show version |

## construct auth:status

Check auth status

**Usage**

```bash
construct auth:status
```

## construct backup

System backups

**Usage**

```bash
construct backup create|restore
```

## construct beads

Task queue management

**Usage**

```bash
construct beads <list|show|create|update|close|drift|stats>
```

## construct beads:stats

Show beads counters and drift summary

**Usage**

```bash
construct beads:stats
```

## construct ci

Local CI mirror: run CI jobs locally or view recent run status

**Usage**

```bash
construct ci <preview|status|list>
```

**Options**

| Flag | Description |
|---|---|
| `--job=<name>` | Run a single CI job by id or name fragment |
| `--list` | List all jobs without running them |
| `--full` | Include Docker/Trivy steps (requires Docker daemon) |

## construct completions

Shell completion scripts

**Usage**

```bash
construct completions <bash|zsh|install>
```

## construct config

Deployment mode configuration

**Usage**

```bash
construct config <get|set>
```

## construct diff

Show agent changes since HEAD

**Usage**

```bash
construct diff
```

## construct embed

Embed mode management

**Usage**

```bash
construct embed start|stop|status
```

## construct gates:audit

Audit policy gates

**Usage**

```bash
construct gates:audit
```

## construct hooks:health

Check hook health

**Usage**

```bash
construct hooks:health
```

## construct list

List all agents

**Usage**

```bash
construct list
```

## construct policy

Show active policy gates with enforcement details

**Usage**

```bash
construct policy show
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output as JSON |

## construct provider

Provider management

**Usage**

```bash
construct provider list|test
```

## construct role

Role framework management

**Usage**

```bash
construct role <list|set|latest>
```

## construct roles:list

List installed role contracts

**Usage**

```bash
construct roles:list
```

## construct roles:set

Activate a role contract

**Usage**

```bash
construct roles:set <role>
```

## construct scheduler

Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup)

**Usage**

```bash
construct scheduler <list|run|runner>
```

## construct skills

Skill relevance detection

**Usage**

```bash
construct skills scope|apply
```

## construct uninstall

Remove Construct state

**Usage**

```bash
construct uninstall [--yes] [--all]
```

**Options**

| Flag | Description |
|---|---|
| `--yes` | Remove auto-risk categories without prompting |
| `--all` | Combined with --yes: also remove ask-risk categories (project data, machine config) |

## construct update

Reinstall this checkout

**Usage**

```bash
construct update
```

## construct upgrade

Upgrade to latest npm version

**Usage**

```bash
construct upgrade
```

## construct validate

Validate registry structure

**Usage**

```bash
construct validate
```

## construct version

Show version

**Usage**

```bash
construct version | construct --version
```
