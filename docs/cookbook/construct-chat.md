---
title: Construct chat
description: Run Construct's owned agent loop in the terminal or browser — transparency-first, provider-agnostic.
---

`construct chat` runs Construct's own agent loop: prompt → model → tool calls → results → repeat. Every token, tool result, permission decision, and routing choice is first-party data — not whatever a host chose to stream.

## Quick start

```bash
construct dev                 # start local services (if not already running)
construct chat                # Ink cockpit on a capable TTY
construct chat --plain        # linear, screen-reader-friendly renderer
construct chat --web          # browser cockpit at /chat/
```

Optional Ink dependencies ship as `optionalDependencies` under `apps/chat/`. If they are missing, the launcher prints an install hint and falls back to linear mode.

## What you see

The default Ink surface shows:

- **Conversation column** — phased turn log (`YOU`, `ROUTE`, `THINKING`, `TOOLS`, `SOURCES`, `CONSTRUCT`, `USAGE`)
- **Session rail** — model, context meter, session usage, transparency layer toggles, route detail
- **Permission prompts** — `y` / `a` / `n` (ask mode) or pre-set sandbox levels

Use `--accessible`, `--plain`, `NO_COLOR`, or `TERM=dumb` for the linear renderer on non-TTY or accessibility needs.

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
construct chat --list          # models available to chat
construct chat --free          # poll OpenRouter free catalog (requires OPENROUTER_API_KEY)
```

## Dashboard parity

`construct chat --web` starts the dashboard and opens `/chat/` with the same owned-loop SSE stream (`GET /api/chat/loop/stream`). Rebuild the static bundle after dashboard changes:

```bash
construct dashboard:sync --build
```

Legacy `/api/chat/*` (Claude `--print` delegation) remains for backward compatibility; new work targets the owned loop.

## Further reading

- [ADR-0041: Terminal chat — own the loop](/adr/0041-terminal-chat-owned-loop)
- [ADR-0039: Interaction-surface model](/adr/0039-interaction-surface-model)
- [Plug in your own LLM](/cookbook/plug-in-your-own-llm)
