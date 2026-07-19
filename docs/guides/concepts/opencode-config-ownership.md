---
title: OpenCode config ownership
description: Which keys in the OpenCode config Construct manages versus which belong to the user, and the merge rules that keep the two from colliding.
---

OpenCode is becoming Construct's first-class support surface, which makes one
question load-bearing: **in a user's OpenCode config, what does Construct own and
what does the user own?** Without a clear answer, every `construct sync` risks
either clobbering a personal setting or leaving Construct's managed surface stale.

This doc is the boundary. It extends the "good citizen" doctrine of
[ADR 0027](../../decisions/adr/0027-host-project-footprint-and-non-destructive-scaffolding.md)
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

## The doctrine: safety + helper quality

Construct is opinionated about exactly two things in a user's personal config,
because both are about protecting the user rather than expressing taste:

- **Safety** — the orchestrator's `bash` permission is scoped so destructive
  commands are denied and remote/history rewrites prompt.
- **Helper quality** — OpenCode's built-in `title`, `summary`, and `compaction`
  agents have their model pin stripped so OpenCode uses its own session-model/
  small_model routing instead of failing when a pinned model's provider lacks
  user credentials.

Everything else that is a matter of preference — the primary `model`, `share`,
`autoupdate`, and the entire `tui.json` (theme, keybinds, notifications) — is
the user's. Construct never writes it.

The rule that makes this safe is **non-destructive seeding** for user-owned
keys: Construct only fills a managed default when the key is *absent*. Provider
auth headers and non-managed agents are explicitly preserved on merge.

## Ownership table

| Config surface | Owner | Rule |
|---|---|---|
| `agent.construct`, `agent.construct-*` (and their prompts) | Construct | Regenerated from the registry + personas; swept by name prefix |
| `agent.construct.permission.bash` | Construct | Scoped map emitted by `opencodePermissions` (deny `rm -rf *`; ask on `git push`/force/`reset --hard`) |
| `agent.<your-name>` | user | Preserved — non-`construct`/`cx-*` agents survive the sweep |
| `mcp.*` (context7, memory, github, …) | Construct | Regenerated from the registry; rewritten only on placeholder/transport mismatch. Opt-in MCPs like `playwright` (added via `construct mcp add`) are not in the registry, so they are left untouched. |
| `mcp.github` Authorization | Construct | Written as `Bearer {env:GITHUB_TOKEN}` — an env ref, never a plaintext token |
| `mcp.<your-server>` | user | Preserved on merge |
| `provider.*` (npm/name/baseURL) | Construct | Regenerated from the registry |
| `provider.openrouter` attribution headers (`HTTP-Referer`, `X-Title`) | Construct | Real constants from the registry — no `__placeholder__` |
| `provider.*.options.headers.Authorization` | user | Preserved on merge — **except** an unresolved `op://`/`__placeholder__` ref, which `op run` cannot resolve inside config JSON; it is stripped so it can't override the working env-ref key and 401 OpenRouter |
| `provider.openrouter.models` | shared | The registry's curated `:free` models are seeded; any models you add are preserved |
| `provider.anthropic.models` | Construct (derived) | Derived from tier definitions; your custom entries preserved |
| `plugin[]` (construct-fallback) | Construct | Seeded; the array is normalized on write — deduped, with non-existent file paths and stray non-path tokens dropped |
| `agent.title`, `agent.summary`, `agent.compaction` | Construct | Model pin is stripped (entries kept); OpenCode falls back to session-model/small_model routing |
| `model` | user | Construct removes the legacy pinned default and never writes a new one |
| `share`, `autoupdate`, `enabled_providers` | user | Never written |
| `tui.json` (theme, attention, keybinds, scroll) | user | Never touched — separate file |

## How preservation works

`syncOpencode` reads the existing config, mutates only the managed sections, and
writes the result — it does not regenerate the file wholesale:

- **Agents** are swept by prefix: a `construct`/`cx-*` agent that is not in the
  current write set is deleted; everything else is left alone. So a user-authored
  agent survives untouched.
- **Providers** merge: the registry definition is spread in, but an existing
  `Authorization` header and any user-added models are merged back over it. The
  one exception is an *unresolved secret reference* (`op://…` or `__PLACEHOLDER__`)
  in a credential field: `op run` only resolves the launch env-file, never config
  JSON, so such a value would be sent verbatim and override the working key. It is
  treated as no-auth — the broken header is stripped and the provider falls back to
  `{env:OPENROUTER_API_KEY}`.
- **The `plugin[]` array** is normalized on every write: deduped, with entries that
  look like file paths but no longer exist (stale checkout locations) and stray
  non-path tokens dropped, so a drifted entry can't break plugin loading.
- **MCP servers** are only rewritten when the existing entry still carries a
  `__placeholder__`, has a transport mismatch, or is missing — otherwise the
  existing entry stands.
- **Helper agents** have their model pin stripped so `agent.title`, `agent.summary`,
  and `agent.compaction` fall back to OpenCode's own session-model/small_model
  routing (entries are kept present for tests and hosts to rely on).
- **`model`** is stripped only for the legacy Construct seed, so the user's
  remembered selection can take effect instead of a stale pin.

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
  "attention": { "enabled": true, "sound": true },
  "diff_style": "auto"  // "auto" = side-by-side on wide terminals; "stacked" = single pane
}
```

Construct does not pin your primary `model`. If you want a different primary
model, choose it in OpenCode and let the app remember it. Helper agents have
their model pin stripped, so they fall back to OpenCode's own routing.

## See also

- [ADR 0027 — Host project footprint & non-destructive scaffolding](../../decisions/adr/0027-host-project-footprint-and-non-destructive-scaffolding.md)
- [Architecture](architecture.mdx)
- The generator: `syncOpencode` and `opencodePermissions` in `scripts/sync-specialists.mjs`; the read/write helpers in `lib/opencode-config.mjs`.
