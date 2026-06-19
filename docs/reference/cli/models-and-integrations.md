---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Describe what this Construct install can do (embedded contract; read-only, secret-free) |
| `construct chat` | Interactive terminal chat on Construct's owned agent loop, with a multi-pane transparency surface (live token/cost/context usage, reasoning, tool timeline, and the planned specialist route); switch models, change settings, and see a token/cost breakdown in-session. Use --accessible or --plain for the linear, screen-reader-friendly renderer |
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

- `[object Object]`

## construct chat

Interactive terminal chat on Construct's owned agent loop, with a multi-pane transparency surface (live token/cost/context usage, reasoning, tool timeline, and the planned specialist route); switch models, change settings, and see a token/cost breakdown in-session. Use --accessible or --plain for the linear, screen-reader-friendly renderer

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

- `[object Object]`

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
construct models <list|set|free|reset|usage|cost|resolve>
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct orchestrate

Construct-owned local orchestration runtime, in-process or against the local daemon (--remote)

**Usage**

```bash
construct orchestrate <run|status> [options] [--remote]
```

**Subcommands**

- `[object Object]`
- `[object Object]`

## construct plugin

Manage external Construct plugin manifests

**Usage**

```bash
construct plugin <list|info|init|validate|engine>
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
