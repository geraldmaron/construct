---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct plugin` | Manage external Construct plugin manifests |

## construct claude:allow

Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it)

**Usage**

```bash
construct claude:allow <check|apply|add|remove>
```

## construct hosts

Show host support for Construct orchestration

**Usage**

```bash
construct hosts [--json]
```

## construct mcp

Manage MCP integrations

**Usage**

```bash
construct mcp <list|add|remove|info>
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
construct models <list|set|free|reset|usage|cost>
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct plugin

Manage external Construct plugin manifests

**Usage**

```bash
construct plugin <list|info|init>
```
