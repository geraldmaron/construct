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
| `construct docs:check` | Check for missing how-to guides (alias for `docs check`) |
| `construct docs:reconcile` | Reconcile docs against the registry |
| `construct docs:site` | Manage the docs static site build |
| `construct docs:update` | Regenerate AUTO-managed doc regions (alias for `docs update`) |
| `construct registry:status` | Inspect the capability registry (`registry/capabilities.json`) |
| `construct registry:validate` | Validate registry entries against repo reality |
| `construct registry:generate-docs` | Regenerate `docs/reference/capabilities.md` from the registry |
| `construct rules usage` | Roll up rule-reference and hook-fire telemetry (`~/.cx/rule-calls.jsonl`, `~/.cx/hook-calls.jsonl`) |

## construct audit

Audit Construct internals and review the mutation trail

**Usage**

```bash
construct audit <events|trail>
```

## construct cleanup

Release dev-agent memory pressure by cleaning stale helper and bridge processes

**Usage**

```bash
construct cleanup [--dry-run] [--quiet] [--pressure-release] [--pressure-only] [--disk-only]
```

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Show what would be cleaned without changing anything |
| `--quiet` | Minimal output |
| `--pressure-release` | Also kill stale dev-agent processes |
| `--pressure-only` | Pressure release only — skip disk cleanup |
| `--disk-only` | Disk cleanup only — skip pressure release |

## construct doc

Verify or inspect auditability stamps on Construct-generated markdown files

**Usage**

```bash
construct doc <verify|inspect>
```

## construct docs:check

Check for missing how-to guides (alias for `docs check`)

**Usage**

```bash
construct docs:check
```

## construct docs:reconcile

Reconcile docs against the registry

**Usage**

```bash
construct docs:reconcile
```

## construct docs:site

Manage the docs static site build

**Usage**

```bash
construct docs:site <build|serve>
```

## construct docs:update

Regenerate AUTO-managed doc regions (alias for `docs update`)

**Usage**

```bash
construct docs:update
```

## construct docs:verify

Validate documentation quality (alias for `docs verify`)

**Usage**

```bash
construct docs:verify
```
