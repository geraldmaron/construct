---
title: Diagnostics
description: Diagnostics commands for Construct.
---

# Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |

## construct audit

Audit Construct internals and review the mutation trail

**Usage**

```bash
construct audit <skills|trail>
```

**Subcommands**

- `[object Object]`
- `[object Object]`

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

## construct doc

Verify or inspect auditability stamps on Construct-generated markdown files

**Usage**

```bash
construct doc <verify|install-hooks> [path] [--json]
```

**Subcommands**

- `[object Object]`
- `[object Object]`
