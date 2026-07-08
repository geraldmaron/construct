---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Describe what this Construct install can do (embedded contract; read-only, secret-free) |
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct db` | Inspect and migrate the optional Postgres backend |
| `construct execution` | Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced) |
| `construct flow` | Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct orchestrate` | Construct-owned local orchestration runtime and readiness preflight |
| `construct plugin` | Manage external Construct plugin manifests |

## construct acp

Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients

**Usage**

```bash
construct acp
```

## construct capability

Describe what this Construct install can do (embedded contract; read-only, secret-free)

**Usage**

```bash
construct capability describe --json
```

**Subcommands**

- `describe --json` — Emit versions, interfaces, roles, skills, workflows, schemas, models, policies, telemetry, plugins

## construct claude:allow

Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it)

**Usage**

```bash
construct claude:allow <check|apply|add|remove>
```

## construct db

Inspect and migrate the optional Postgres backend

**Usage**

```bash
construct db <status|migrate> [--json]
```

**Subcommands**

- `status [--json]` — Check Postgres reachability and migration state
- `migrate [--json]` — Apply pending Postgres migrations idempotently

## construct execution

Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced)

**Usage**

```bash
construct execution resolve --json
```

**Subcommands**

- `resolve --json` — Report executionMode, active Construct capabilities, and any degradation given host/strategy context

## construct flow

Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status

**Usage**

```bash
construct flow <resume|status> <run-id> [--flow=<path>] [--state=<json>]
```

**Subcommands**

- `resume <run-id> --flow=<path> [--state=<json>]` — Start (new run-id) or resume a checkpointed flow and drive it to completion
- `status <run-id>` — Read a flow checkpoint without driving it

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

- `list` — List configured MCP integrations
- `add <id>` — Add an MCP integration by id
- `remove <id>` — Remove an MCP integration
- `info <id>` — Show details for one MCP integration

## construct models

Show or update model tier assignments

**Usage**

```bash
construct models <list|set|free|reset|resolve|policy|explain>
```

**Subcommands**

- `list` — Show current tier assignments
- `set --tier=<reasoning|standard|fast> --model=<model>` — Set a model for a tier
- `free` — List available free models
- `reset` — Reset all tier assignments
- `resolve --json` — Resolve the model for an embedded workflow given host context
- `policy show` — Show the effective policy: winning source per tier + work-category map
- `policy set <budget|free|frontier|local>` — Compute a preset and persist it to specialists/org/models.json
- `explain --role <specialist>` — Per-specialist model resolution trace

## construct orchestrate

Construct-owned local orchestration runtime and readiness preflight

**Usage**

```bash
construct orchestrate <run|status|preflight> [options] [--remote]
```

**Subcommands**

- `run "<request>" [--strategy S] [--host H] [--worker-backend provider] [--no-construct] [--no-execute] [--json] [--remote]` — Plan and run a request through a Construct-owned specialist chain; --remote drives the local daemon over HTTP
- `status [run-id] [--json] [--remote]` — Inspect a run, or list recent runs (locally or from the daemon)
- `preflight [--host H] [--json] [--no-probe]` — Verify orchestration tool attachment/readiness and return a typed reason plus recovery step

## construct plugin

Manage external Construct plugin manifests

**Usage**

```bash
construct plugin <list|info|init|validate|engine>
```

**Subcommands**

- `list` — List discovered plugin manifests
- `info <id>` — Show details for one plugin
- `init` — Scaffold a new plugin manifest
- `validate` — Validate a plugin manifest against the schema
- `engine` — Plugin engine operations
