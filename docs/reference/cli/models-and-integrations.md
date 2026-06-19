---
title: Models & Integrations
description: Models & Integrations commands for Construct.
---

# Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Describe what this Construct install can do (embedded contract; read-only, secret-free) |
| `construct chat` | Interactive terminal chat on Construct's owned agent loop, with a multi-pane transparency surface (live token/cost/context usage, reasoning, tool timeline, and the planned specialist route); switch models, change settings, and see a token/cost breakdown in-session. Use `--accessible` or `--plain` for the linear, screen-reader-friendly renderer |
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

Interactive terminal chat on Construct's owned agent loop. Each turn renders inline in the conversation column (policy route, thinking, tools, markdown answer, sources consulted); the right panel is a session dock with an optional per-turn inspector (`/inspect`, Ctrl-O, or `/set inspector auto|on|off`). Use `--accessible` or `--plain` for the linear, screen-reader-friendly renderer with the same turn ordering.

**Turn layout**

- **TurnBlock** — user message → turn context (intent, route, external-research badge, sources from tool events) → thinking → tools → construct answer (markdown) → turn usage
- **SessionDock** — model, sandbox, permission, layers, context meter, session token/cost totals
- **TurnInspector** — optional deep dive on the active turn (toggle `/inspect` or `ui.inspector` in `chat-config.json`)

**Ink controls**

- `/model` or `/models` — searchable picker (type to filter, ↑/↓, Enter, Esc); includes **OpenRouter free router** and live `:free` models when configured
- `/free` — set the free-router model (same as `construct chat --free`)
- `/set` — searchable setting picker, then value picker for enums/bools
- Permission prompts — same list picker (↑/↓, Enter, or y/a/n)
- **Tab** — completes slash commands and `/set` keys
- **Theme** — auto-detect light/dark from the terminal (`COLORFGBG`); override with `CX_CHAT_THEME=light|dark` or `/set theme auto|light|dark`
- **Model mode** — `/free` or picker **free router** sets `modelMode: free-router` (re-picks at launch + on 429/404); pinned models set `modelMode: pinned`
- **Export** — `/export last` or `/export session` writes plain markdown to `.cx/chat-sessions/exports/` for copy/paste
- ↑/↓ while typing an incomplete `/command` cycles matching commands

**Usage**

```bash
construct chat [--model <id>] [--list] [--resume[=file]] [--ascii] [--plain] [--accessible] [--no-thinking] [--no-path] [--no-specialists] [--no-tools] [--no-observability] [--quiet]
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
