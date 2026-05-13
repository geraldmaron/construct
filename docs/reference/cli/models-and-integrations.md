---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct plugin` | Manage external Construct plugin manifests |

## construct hosts

Show host support for Construct orchestration

**Usage**

```bash
construct hosts
```

## construct mcp

Manage MCP integrations

**Usage**

```bash
construct mcp <list|add|remove|info> [name]
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct models

Show or update model tier assignments

**Usage**

```bash
construct models [--poll|--apply|--reset|--tier=TIER|--set=MODEL|--prefer-free|--prefer-free-same-family]
```

**Options**

| Flag | Description |
|---|---|
| `--poll` | Query OpenRouter for currently free models |
| `--apply` | Auto-apply best free models and sync |
| `--reset` | Remove model overrides, restore defaults |
| `--tier=TIER` | Target tier: reasoning | standard | fast |
| `--set=MODEL_ID` | Set specific model for the tier |
| `--prefer-free` | When inferring sibling tiers, prefer free models where possible |
| `--prefer-free-same-family` | Prefer free siblings only when they stay in the same provider family |

## construct plugin

Manage external Construct plugin manifests

**Usage**

```bash
construct plugin <list|info|validate|init> [name]
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
