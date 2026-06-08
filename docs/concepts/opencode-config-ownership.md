---
title: OpenCode config ownership
description: Which keys in the OpenCode config Construct manages versus which belong to the user, and the merge rules that keep the two from colliding.
---

OpenCode is becoming Construct's first-class support surface, which makes one
question load-bearing: **in a user's OpenCode config, what does Construct own and
what does the user own?** Without a clear answer, every `construct sync` risks
either clobbering a personal setting or leaving Construct's managed surface stale.

This doc is the boundary. It extends the "good citizen" doctrine of
[ADR 0027](../adr/0027-host-project-footprint-and-non-destructive-scaffolding.md)
from the *project* footprint to the *global* OpenCode config that is the user's
daily driver.

## Two scopes

OpenCode reads config from two files Construct touches:

| Scope | Path | Construct's behavior |
|---|---|---|
| **Global** | `~/.config/opencode/opencode.json` | The user's daily driver. Construct **merges** managed keys into it and never creates it from scratch beyond an empty skeleton. Global sync writes only when the file already exists. |
| **Project** | `<repo>/.opencode/opencode.json` | Construct-generated and git-ignored. Regenerated on every `construct sync`; safe to delete. |

`setup.mjs`'s `ensureOpenCodeConfig` seeds only an empty skeleton
(`$schema`, `mcp:{}`, `agent:{}`) when no global config exists, and never
re-runs against an existing one. All managed writes flow through `syncOpencode`
in `scripts/sync-specialists.mjs`. TUI settings live in a **separate** file,
`~/.config/opencode/tui.json`, which Construct never writes.

## The doctrine: safety + cost only

Construct is opinionated about exactly two things in a user's personal config,
because both are about protecting the user rather than expressing taste:

- **Safety** — the orchestrator's `bash` permission is scoped so destructive
  commands are denied and remote/history rewrites prompt.
- **Cost** — `small_model` is seeded so cheap auxiliary work (titles, summaries)
  doesn't run on an expensive model.

Everything else that is a matter of preference — `model`, `share`, `autoupdate`,
and the entire `tui.json` (theme, keybinds, notifications) — is the user's.
Construct never writes it.

The rule that makes this safe is **non-destructive seeding**: Construct writes a
managed default only when the key is *absent*. A value the user has set is never
overridden. `small_model` seeding guards on `=== undefined`; provider auth
headers and non-managed agents are explicitly preserved on merge.

## Ownership table

| Config surface | Owner | Rule |
|---|---|---|
| `agent.construct`, `agent.cx-*` (and their prompts) | Construct | Regenerated from the registry + personas; swept by name prefix |
| `agent.construct.permission.bash` | Construct | Scoped map emitted by `opencodePermissions` (deny `rm -rf *`; ask on `git push`/force/`reset --hard`) |
| `agent.<your-name>` | user | Preserved — non-`construct`/`cx-*` agents survive the sweep |
| `mcp.*` (context7, memory, github, …) | Construct | Regenerated from the registry; rewritten only on placeholder/transport mismatch. Opt-in MCPs like `playwright` (added via `construct mcp add`) are not in the registry, so they are left untouched. |
| `mcp.github` Authorization | Construct | Written as `Bearer {env:GITHUB_TOKEN}` — an env ref, never a plaintext token |
| `mcp.<your-server>` | user | Preserved on merge |
| `provider.*` (npm/name/baseURL) | Construct | Regenerated from the registry |
| `provider.openrouter` attribution headers (`HTTP-Referer`, `X-Title`) | Construct | Real constants from the registry — no `__placeholder__` |
| `provider.*.options.headers.Authorization` | user | Preserved on merge (your API keys are never overwritten) |
| `provider.openrouter.models` | shared | The registry's curated `:free` models are seeded; any models you add are preserved |
| `provider.anthropic.models` | Construct (derived) | Derived from tier definitions; your custom entries preserved |
| `plugin[]` (construct-fallback) | Construct | Regenerated |
| `small_model` | Construct (cost) | **Seeded only when absent**; never overrides your choice |
| `model` | user | Never written |
| `share`, `autoupdate`, `enabled_providers` | user | Never written |
| `tui.json` (theme, attention, keybinds, scroll) | user | Never touched — separate file |

## How preservation works

`syncOpencode` reads the existing config, mutates only the managed sections, and
writes the result — it does not regenerate the file wholesale:

- **Agents** are swept by prefix: a `construct`/`cx-*` agent that is not in the
  current write set is deleted; everything else is left alone. So a user-authored
  agent survives untouched.
- **Providers** merge: the registry definition is spread in, but an existing
  `Authorization` header and any user-added models are merged back over it.
- **MCP servers** are only rewritten when the existing entry still carries a
  `__placeholder__`, has a transport mismatch, or is missing — otherwise the
  existing entry stands.
- **`small_model`** is set only when `config.small_model === undefined`.

The one historical exception is the legacy top-level `construct` key, which
OpenCode's strict schema rejects; `sanitizeOpenCodeConfig` strips it on write.

## Setting your personal config

Because Construct never writes these, they are yours to set directly in
`~/.config/opencode/opencode.json` (or `tui.json`) and they survive every sync:

```jsonc
{
  "model": "anthropic/claude-opus-4-6",     // your primary model
  "share": "disabled",                       // keep sessions private
  "autoupdate": "notify"                     // your update posture
}
```

```jsonc
// ~/.config/opencode/tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "opencode",
  "attention": { "enabled": true, "sound": true }
}
```

Construct will seed `small_model` if you have not set one; to keep your own
choice, just set it — the seed only fills an empty slot.

## See also

- [ADR 0027 — Host project footprint & non-destructive scaffolding](../adr/0027-host-project-footprint-and-non-destructive-scaffolding.md)
- [Architecture](architecture.mdx)
- The generator: `syncOpencode` and `opencodePermissions` in `scripts/sync-specialists.mjs`; the read/write helpers in `lib/opencode-config.mjs`.
