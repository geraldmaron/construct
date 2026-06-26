---
title: Construct chat
description: Run Construct's owned agent loop in the terminal — transparency-first, provider-agnostic.
---

Running `construct` with no subcommand runs Construct's own agent loop: prompt → model → tool calls → results → repeat. Every token, tool result, permission decision, and routing choice is first-party data — not whatever a host chose to stream. (`construct chat` is a deprecated alias for the same entry and prints a notice.)

Chat is terminal-only. The desktop window and browser cockpit were retired with the dashboard server (`construct-m7k2-web-deprecation`); the linear renderer (`lib/chat/tui/render.mjs`) is the sole surface. The retired `--web` / `--window` / `--no-window` flags print a one-line notice and no-op.

## Quick start

```bash
construct dev                 # start local services (if not already running)
construct                     # interactive chat in the terminal
construct --plain             # screen-reader-friendly linear mode
```

## What you see

The terminal renderer prints each turn as a labeled, screen-reader-friendly transcript; meaning never depends on color (color is enhancement only, gated by `NO_COLOR`, non-TTY, and `TERM=dumb`).

- **Turn phases** — labeled sections per turn (`[thinking]`, `[tool]`, `construct`, `[usage]`)
- **Route** — the planned specialist chain, intent, and track for the turn
- **Tools** — a status-aligned list of tool calls with results
- **Usage** — a per-turn token/cost footer

`--plain` / `--accessible` select the linear mode explicitly; `NO_COLOR` and `TERM=dumb` also route there.

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

## Further reading

- [ADR-0041: Terminal chat — own the loop](/decisions/adr/0041-terminal-chat-owned-loop)
- [ADR-0039: Interaction-surface model](/decisions/adr/0039-interaction-surface-model)
- [Plug in your own LLM](/guides/cookbook/plug-in-your-own-llm)
