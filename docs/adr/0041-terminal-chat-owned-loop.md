<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0041: Terminal chat surface — own the loop, own the surface

- **Date**: 2026-06-18
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Supersedes**: ADR-0040

## Problem

ADR-0040 shipped `construct chat` as a delegate-the-loop surface: Construct
drove whatever agent host the user already ran (OpenCode over its HTTP/SSE
server; Claude/Codex/Gemini via CLI or ACP adapters) and owned only a linear,
inline transparency overlay rendered through a readline REPL
(`lib/chat/tui/render.mjs`).

Two limits surfaced in use. First, the **presentation** is structurally
linear: the renderer interleaves `[thinking]`, `[tool]`, and `[usage]` labels
into one scrolling stream, so there is no durable, glanceable place to show a
breakdown of token usage, reasoning, messaging, and routing as first-class,
continuously-updated panels. Second, **delegation puts the loop's fidelity in
the host's hands**: Construct sees only what the host chooses to stream, cannot
attribute usage per tool or per specialist beyond what the host reports, and
inherits the host's permission and model semantics. The differentiator —
maximum transparency into the agent loop — is capped by the least transparent
host.

The open question ADR-0040 deferred ("should Construct build its own agent
loop") is reopened deliberately, because the product has matured past the
constraint that made delegation the safe default.

## Decision

Ship `construct chat` as an **own-the-loop, own-the-surface** experience:

- **Owned loop (`apps/chat/engine/`).** Construct runs the agent loop itself on
  a provider-agnostic engine (Vercel AI SDK `ToolLoopAgent`): prompt -> model
  -> tool calls -> tool results -> repeat, with streaming and per-step usage.
  Model and credential resolution reuse the existing core
  (`lib/model-router.mjs`, `lib/env-config.mjs`); the engine never hardcodes a
  provider. The loop is exposed to the rest of the surface as **another driver
  implementing the existing normalized event union**
  (`lib/chat/harness/driver.mjs`), so the renderer, transparency overlay,
  persistence, and `/usage` panel are unchanged seams.
- **Owned tools (`apps/chat/engine/tools/`).** Construct supplies its own agent
  tool primitives (read, grep, glob, edit, write, shell) behind a permission and
  sandbox gate that reuses the host-agnostic decision vocabulary
  (`allow` | `allow_always` | `reject`) ADR-0040 defined. Construct-native tools
  (knowledge search, orchestration policy, etc.) are bridged through the
  existing MCP dispatcher (`dispatchToolByName`, `lib/mcp/server.mjs`); bounded
  shell reuses `lib/worker/run.mjs`.
- **Owned surface (`apps/chat/tui/`).** A multi-pane Ink TUI renders the
  conversation in a main pane and a dedicated transparency side panel (live
  tokens/cost/context window, reasoning, tool timeline, and the specialist route
  the policy would select). Ink is the proven Node-native React TUI used by the
  peer agents Construct sits beside.
- **Accessible by construction.** The full-screen Ink TUI is the default only on
  a capable interactive TTY. `--plain`, `--accessible`, `NO_COLOR`, `TERM=dumb`,
  and any non-TTY stream route to the retained linear renderer
  (`lib/chat/tui/render.mjs`). Both consume the same event union, so there is one
  event model and two renderers, not two surfaces.

## Rationale

Owning the loop is the only way the transparency promise becomes truthful end to
end: when Construct issues the model calls and executes the tools, every token,
tool result, permission decision, and routing choice is first-party data, not a
host's optional stream. Provider-agnosticism is preserved by choosing a
provider-agnostic engine rather than a single vendor SDK, which keeps Construct
on the right side of ADR-0003 (provider interface) and the tool-agnostic
posture.

This is consistent with ADR-0022's core posture — "the engine owns
orchestration" — extended from specialist sequencing to the coding loop. It is
*inconsistent* with ADR-0040's specific delegate decision and with the strategy
non-bet "not another model runtime"; both are superseded here as a deliberate,
documented maturation rather than drift. The boundary that remains is the IDE
non-bet: this is a terminal surface and an engine, not an editor.

Dependency weight is contained, not waved away. The loop engine and the Ink TUI
live in an ADR-0001-exempt zone (`apps/chat/`, mirroring `apps/dashboard/`), and
their packages ship as `optionalDependencies` so the core `npm install -g`
stays lean for locked-down and air-gapped installs. The zero-dep core
(`lib/`, `bin/`) is untouched except for the thin launcher and the event
contract, which remain built-in only.

## Rejected alternatives

- **Keep delegate-the-loop (ADR-0040 unchanged).** Rejected: caps transparency
  at the host's stream and leaves presentation tied to a linear renderer that
  cannot host first-class panels. The reframing that "the renderer, not
  OpenCode, was the limit" is true but insufficient — a richer renderer over a
  delegated loop still cannot attribute usage or routing the host does not emit.
- **Own the loop, hand-roll the TUI (zero-dep).** Rejected for now: a
  multi-pane, live-updating, resize-aware TUI is substantial in-house rendering
  code; Ink is mature, maintained, and the de-facto standard among peer agents.
  Kept as the fallback if the dependency cost proves unacceptable.
- **Own the loop with a single-vendor agent SDK (Anthropic/OpenAI).** Rejected:
  couples Construct to one provider's runtime, contradicting the provider
  interface and the tool-agnostic posture. A provider-agnostic engine keeps the
  multi-provider reach delegation gave us.
- **Hybrid: owned loop plus the delegate adapters as selectable engines.**
  Deferred, not rejected: it is the maximum-flexibility, maximum-surface option.
  Retiring the adapters now buys a coherent single engine; they can return as
  alternative engines later behind the same driver contract (a two-way door).

## Consequences

- The delegate adapters (`opencode-adapter.mjs`, `claude-adapter.mjs`,
  `codex-adapter.mjs`, `acp-client.mjs`), host resolution (`hosts.mjs`), and
  model suitability (`model-suitability.mjs`) are retired. `lib/chat/cli.mjs`
  rewires from host resolution to the owned-loop driver; `commands.mjs` reads
  models from `lib/model-router.mjs` instead of a host's `listModels`.
- New `optionalDependencies` (`ai`, `@ai-sdk/*`, `ink`, `react`, `zod`) ride the
  existing optional-dependency pattern; `construct chat` detects missing extras
  and prints an install hint. A JSX build step (esbuild, already present for
  `build:sea`) compiles the Ink surface; the launcher loads the built bundle.
- Construct now owns a coding agent loop and file-edit/permission primitives,
  with the ongoing maintenance that implies.
- Convergence opportunity (future, out of scope here): one owned loop can back
  terminal chat, the ACP agent (`lib/acp/server.mjs`, ADR-0023, today hardcoded
  to the `inline` worker), and browser chat (`lib/server/chat.mjs`, today spawns
  `claude`).

## Reversibility

Two-way door at the seam, one-way-ish at the dependency. The owned-loop driver
implements the same event union the delegate adapters did, so reverting to
delegation is re-adding adapters behind that contract. The `optionalDependencies`
and the `apps/chat/` zone are additive; removing them leaves the zero-dep core,
the linear renderer, and the event contract intact. The deliberate
boundary-crossing (owning a loop) is the part that is costly to unwind, which is
why it is recorded as a decision, not a default.

## References

- Supersedes ADR-0040 (terminal chat — delegated loop)
- ADR-0001 (zero-npm-core — amended here for the `apps/chat/` exempt zone and the
  optional chat dependencies)
- ADR-0003 (provider interface), ADR-0022 (orchestration daemon — engine owns
  orchestration), ADR-0023 (ACP agent), ADR-0030 (chain-of-thought disclosure),
  ADR-0039 (interaction-surface model — chat is now a first-class agent surface)
- `apps/chat/**` (owned loop engine, tools, Ink TUI), `lib/chat/**` (zero-dep
  launcher, event contract, linear renderer, config, commands)
- `lib/model-router.mjs`, `lib/orchestration-policy.mjs`, `lib/worker/run.mjs`,
  `lib/mcp/server.mjs` (`dispatchToolByName`) — reused by the engine
