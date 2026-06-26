---
title: Construct chat
description: Run Construct's owned agent loop in the terminal — transparency-first, provider-agnostic.
---

Running `construct` with no subcommand runs Construct's own agent loop: prompt → model → tool calls → results → repeat. Every token, tool result, permission decision, and routing choice is first-party data — not whatever a host chose to stream.

Chat is terminal-only. The desktop window and browser cockpit were retired with the dashboard server (`construct-m7k2-web-deprecation`); the linear renderer (`lib/chat/tui/render.mjs`) is the sole surface. The retired `--web` / `--window` / `--no-window` flags print a one-line notice and no-op.

## Quick start

```bash
construct dev                 # start local services (if not already running)
construct                     # interactive chat in the terminal
construct --plain             # screen-reader-friendly linear mode
```

## What you see

The terminal renderer prints a branded startup banner (ASCII wordmark + version) and a boxed session summary on exit when banner mode is enabled. The wordmark follows terminal theme (white on dark, black on light). Each turn is a labeled, screen-reader-friendly transcript; meaning never depends on color (color is enhancement only, gated by `NO_COLOR`, non-TTY, and `TERM=dumb`).

- **Session bookends** — startup banner with model/transparency card; `/exit` farewell with session id, tool stats, timing, and `construct --resume=…` hint
- **Slash palette** — typing `/` at the prompt shows a live-filtered command list in the reserved block above the input (Tab completion still works); paste and bracketed paste are unchanged. Run `scripts/visual-slash-stages.exp` for a PTY smoke of all slash stages.
- **Turn phases** — labeled sections per turn (`THINKING` summary when enabled, tools, formatted `construct` answer, usage footer). Assistant replies render as terminal-formatted markdown (headings, bullets, tables), not raw `#` / `**` / pipe syntax. Repo paths and markdown links are OSC-8 clickable in VS Code, Cursor, and other supported terminals.
- **Route** — the planned specialist chain, intent, and track for each turn (immediate/direct turns still show the policy specialist path)
- **Tools** — a status-aligned list of tool calls with results
- **Usage** — a per-turn token/cost footer

Model reasoning (`thinking` layer) is **off by default**, but hosted models show a **live reasoning strip** in the 3-row activity ticker during the turn. Tool calls appear in a single updating ticker row (`read README.md · grep "foo" …`) instead of one line per call. Turn on the full capped THINKING summary with `/set thinking on`; route, tools, and usage stay visible. Run `/layers` for the full transparency tree.

`--plain` / `--accessible` select the linear mode explicitly; `NO_COLOR` and `TERM=dumb` also route there.

## In-session commands

| Command | Action |
|---|---|
| `/model` or `/models` | Full-screen searchable picker (type to filter, ↑↓ to scroll, Enter to select, Esc to cancel) |
| `/follow` | Follow `CX_MODEL_*` tier defaults (clears any pin) |
| `/layers` | Transparency layers with descriptions and toggle hints |
| `/set` or `/settings` | Permission mode, sandbox, transparency layers, theme — `/set` alone lists keys |
| `/usage` | Session token and cost breakdown |
| `/oracle` | Oracle verdict detail when not healthy |
| `/free` | Switch to OpenRouter free-router mode |
| `/clear` | Clear the conversation pane |
| `/help` | Full command list |

Settings persist to `.cx/chat-config.json`. Transcript rows persist to `.cx/chat-sessions/*.jsonl` for `--resume`.

Disable the banner and exit summary with `CX_CHAT_BANNER=0`, `--no-banner`, `--plain`, or `/set banner off`.

## Credentials and models

Models resolve through the shared router (`lib/model-router.mjs`). By default chat **follows tier defaults** (`follow-tier` mode) — no slug is saved until you pick one in `/model`. API keys in `~/.config/construct/config.env` support plain values and `op://` 1Password references. Pin tiers with `CX_MODEL_REASONING`, `CX_MODEL_STANDARD`, `CX_MODEL_FAST`.

```bash
construct creds list
construct --list               # models available to chat
construct --free               # poll OpenRouter free catalog (requires OPENROUTER_API_KEY)
```

## Further reading

- [ADR-0041: Terminal chat — own the loop](/decisions/adr/0041-terminal-chat-owned-loop)
- [ADR-0039: Interaction-surface model](/decisions/adr/0039-interaction-surface-model)
- [Plug in your own LLM](/guides/cookbook/plug-in-your-own-llm)
