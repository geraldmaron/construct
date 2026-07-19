---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Inspect typed operations the system can perform |
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct db` | Inspect and migrate the optional Postgres backend |
| `construct execution` | Resolve the execution-capability contract for an embedded procedure (orchestrated vs prompt-only; descriptive, not enforced) |
| `construct flow` | Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct orchestrate` | Construct-owned local orchestration runtime and readiness preflight |
| `construct plugin` | Manage external Construct plugin manifests |
| `construct tracker` | Analyze registered projects and contribute governed issue proposals to an external tracker (Jira) |

## construct acp

Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients

**Usage**

```bash
construct acp
```

## construct capability

Inspect typed operations the system can perform

**Usage**

```bash
construct capability list|show
```

**Subcommands**

- `list` — List capabilities
- `show <id>` — Show one capability

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

Resolve the execution-capability contract for an embedded procedure (orchestrated vs prompt-only; descriptive, not enforced)

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
- `resolve --json` — Resolve the model for an embedded procedure given host context
- `policy show` — Show the effective policy: winning source per tier + work-category map
- `policy set <budget|free|frontier|local>` — Compute a preset and persist it to specialists/org/models.json
- `explain --worker-profile <id>` — Per-worker-profile model resolution trace

## construct orchestrate

Construct-owned local orchestration runtime and readiness preflight

**Usage**

```bash
construct orchestrate <run|status|preflight> [options] [--remote]
```

**Subcommands**

- `run "<request>" [--strategy S] [--host H] [--worker-backend provider] [--no-construct] [--no-execute] [--json] [--remote]` — Plan and run a request through Construct-owned worker assignments; --remote drives the local daemon over HTTP
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

## construct tracker

Analyze registered projects and contribute governed issue proposals to an external tracker (Jira)

**Usage**

```bash
construct tracker contribute --target <id> [--against <ids|all>] | --apply <proposal-id> [--approve <token>]
```

**Subcommands**

- `contribute --target <id> [--against <ids|all>]` — Analyze corpora vs the tracker and emit an evidence-cited, deduped proposal artifact
- `contribute --apply <proposal-id> [--approve <token>]` — Apply a proposal: dry-run by default; --approve executes the governed write batch
