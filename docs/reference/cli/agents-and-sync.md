---
title: Agents & Sync
description: Agents & Sync commands for Construct.
---

# Agents & Sync

| Command | What it does |
|---|---|
| `construct list` | Show all personas and specialist agents |
| `construct role` | Inspect or manage role-framework pending invocations |
| `construct sync` | Generate agent adapters for all platforms |

## construct list

Show all personas and specialist agents

**Usage**

```bash
construct list
```

## construct role

Inspect or manage role-framework pending invocations

**Usage**

```bash
construct role [list|latest|show <fp>|status|resolve <fp>|reset]
```

## construct sync

Generate agent adapters for all platforms

**Usage**

```bash
construct sync [--project] [--no-docs]
```

**Options**

| Flag | Description |
|---|---|
| `--project` | Sync to current project directory only |
| `--no-docs` | Skip AUTO docs regeneration and only refresh host adapters/completions |
