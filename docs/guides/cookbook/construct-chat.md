---
title: Construct chat
description: Run Construct's owned agent loop in a dedicated window or browser — transparency-first, provider-agnostic.
---

Running `construct` with no subcommand runs Construct's own agent loop: prompt → model → tool calls → results → repeat. Every token, tool result, permission decision, and routing choice is first-party data — not whatever a host chose to stream. (`construct chat` is a deprecated alias for the same entry and prints a notice.)

## Quick start

```bash
construct dev                 # start local services (if not already running)
construct                     # dedicated Construct chat window (Tauri + system WebView)
construct --plain             # linear terminal mode (SSH, CI, scripts only)
```

Build the desktop window binary once:

```bash
npm run build:chat-desktop
```

If the binary is missing, `construct` prints an install hint with the build command.

## What you see

The default **desktop window** loads the same React cockpit as dashboard `/chat/` — Space Grotesk and JetBrains Mono via `next/font`, full CSS layout freedom, no browser chrome.

- **Conversation column** — turn cards with phased log lines (`YOU`, `ROUTE`, `THINK`, `TOOL`, `SRC`, `OUT`, `USAGE`)
- **ROUTE strip** — full planned specialist chain inline (`cx-researcher → cx-architect → …`), intent, track, and gates — not just a specialist count
- **Session rail** — model, context meter, session usage, transparency layer toggles, dispatch detail
- **Permission prompts** — `y` / `a` / `n` (ask mode) or pre-set sandbox levels
- **Keyboard shortcuts** — Ctrl+1–5 toggle layers, Ctrl+O expand tool detail, Escape cancel stream

Use `--plain`, `--accessible`, `NO_COLOR`, or `TERM=dumb` only for headless or SSH workflows.

## In-session commands

| Command | Action |
|---|---|
| `/model` or `/models` | Searchable model picker (includes OpenRouter free router when configured) |
| `/set` or `/settings` | Permission mode, sandbox, transparency layers, theme |
| `/usage` | Session token and cost breakdown |
| `/oracle` | Oracle verdict detail when not healthy |
| `/free` | Switch to OpenRouter free-router mode |
| `/clear` | Clear the conversation pane |
| `/help` | Full command list |

Settings persist to `.cx/chat-config.json`. Transcript rows persist to `.cx/chat-sessions/*.jsonl` for `--resume`.

## Credentials and models

Models resolve through the shared router (`lib/model-router.mjs`). API keys in `~/.construct/config.env` support plain values and `op://` 1Password references. Pin tiers with `CX_MODEL_REASONING`, `CX_MODEL_STANDARD`, `CX_MODEL_FAST`.

```bash
construct creds list
construct --list               # models available to chat
construct --free               # poll OpenRouter free catalog (requires OPENROUTER_API_KEY)
```

## Dashboard parity

The dashboard serves the same React cockpit at `/chat/` with the owned-loop SSE stream (`GET /api/chat/loop/stream`); reach it via `construct dashboard`. The `construct chat --web` launcher shortcut was retired (see `construct-m7k2-web-deprecation`). Rebuild the static bundle after dashboard changes:

```bash
construct dashboard:sync --build
```

Legacy `/api/chat/*` (Claude `--print` delegation) remains for backward compatibility; new work targets the owned loop.

## Further reading

- [ADR-0041: Terminal chat — own the loop](/decisions/adr/0041-terminal-chat-owned-loop)
- [ADR-0039: Interaction-surface model](/decisions/adr/0039-interaction-surface-model)
- [Plug in your own LLM](/guides/cookbook/plug-in-your-own-llm)
