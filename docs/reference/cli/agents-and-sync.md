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
construct sync [--project] [--dry-run] [--no-docs] [--compress-personas]
```

**Options**

| Flag | Description |
|---|---|
| `--project` | Sync to the current project's `.claude/` directory only |
| `--dry-run` | Preview adapter changes without writing files |
| `--no-docs` | Skip AUTO docs regeneration and only refresh host adapters/completions |
| `--compress-personas` | Write compressed runtime persona prompts without changing the source prompts. Recommended when `CONSTRUCT_MODEL_PROFILE=small`. |
