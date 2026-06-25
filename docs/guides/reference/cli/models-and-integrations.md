---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Describe what this Construct install can do (embedded contract; read-only, secret-free) |
| `construct chat` | Deprecated alias — run `construct` with no subcommand instead. Interactive terminal chat on Construct's owned agent loop, with a multi-pane transparency surface (live token/cost/context usage, reasoning, tool timeline, and the planned specialist route); switch models, change settings, and see a token/cost breakdown in-session. Use --accessible or --plain for the linear, screen-reader-friendly renderer |
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct execution` | Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced) |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct orchestrate` | Construct-owned local orchestration runtime, in-process or against the local daemon (--remote) |
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

## construct chat

Deprecated alias — run `construct` with no subcommand instead. Interactive terminal chat on Construct's owned agent loop, with a multi-pane transparency surface (live token/cost/context usage, reasoning, tool timeline, and the planned specialist route); switch models, change settings, and see a token/cost breakdown in-session. Use --accessible or --plain for the linear, screen-reader-friendly renderer

**Usage**

```bash
construct chat [--model <id>] [--free] [--list] [--resume[=file]] [--ascii] [--plain] [--accessible] [--no-thinking] [--no-path] [--no-specialists] [--no-tools] [--no-observability] [--quiet]
```

## construct claude:allow

Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it)

**Usage**

```bash
construct claude:allow <check|apply|add|remove>
```

## construct execution

Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced)

**Usage**

```bash
construct execution resolve --json
```

**Subcommands**

- `resolve --json` — Report executionMode, active Construct capabilities, and any degradation given host/strategy context

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
construct models <list|set|free|reset|resolve>
```

**Subcommands**

- `list` — Show current tier assignments
- `set --tier=<reasoning|standard|fast> --model=<model>` — Set a model for a tier
- `free` — List available free models
- `reset` — Reset all tier assignments
- `resolve --json` — Resolve the model for an embedded workflow given host context

## construct orchestrate

Construct-owned local orchestration runtime, in-process or against the local daemon (--remote)

**Usage**

```bash
construct orchestrate <run|status> [options] [--remote]
```

**Subcommands**

- `run "<request>" [--strategy S] [--host H] [--worker-backend provider] [--no-construct] [--no-execute] [--json] [--remote]` — Plan and run a request through a Construct-owned specialist chain; --remote drives the local daemon over HTTP
- `status [run-id] [--json] [--remote]` — Inspect a run, or list recent runs (locally or from the daemon)

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
