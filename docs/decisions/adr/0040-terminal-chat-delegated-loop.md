<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0040: Terminal chat surface — delegate the agent loop, own the transparency

- **Date**: 2026-06-18
- **Status**: superseded
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none
- **Superseded by**: ADR-0041 (terminal chat — own the loop, own the surface)

## Problem

This ADR originates from a maintainer request (this session) for a first-class
`construct` terminal experience comparable to typing `claude`, `codex`, or
`gemini` — but exposing what those surfaces hide: the agent's thinking, the full
execution path, tool calls, and which specialists Construct's policy would route
the request through. The open question is whether Construct should build its own
agent loop (model calls, tool dispatch, file edits) to power this, or drive an
agent the user already runs.

Building a loop would duplicate exactly what ADR-0022 names a non-goal ("the
engine owns orchestration; the host is a thin client") and what the strategy
records as a non-bet ("not building an IDE"). It would also fragment from the
tool-agnostic posture: Construct's value is the orchestration and transparency
layer, not another model runtime.

## Decision

Ship `construct chat` as a **delegate-the-loop** surface. Construct does not run
the agent loop; it drives whatever capable agent host the user already has and
owns only the transparency, routing overlay, and accessible rendering. This is
the (c) TUI tier of ADR-0039 made real, and the in-terminal sibling of the
ACP *agent* role from ADR-0023 — Construct now plays both roles: an ACP/host
*client* here, an ACP agent there.

Concretely:

- **Smart host resolution (`lib/chat/hosts.mjs`).** A data-driven registry
  probes which agent binaries are actually installed — resolving the real binary
  via PATH so a host wrapped as a shell function or behind `op run` is still
  detected — and selects from, in order: an explicit `--host`, `CX_CHAT_HOST`,
  then the highest-ranked installed host. OpenCode ranks first as the
  terminal-native surface. No model is hardcoded; each adapter defers model
  choice to the host's own configuration.
- **Normalized driver contract (`lib/chat/harness/driver.mjs`).** Every host is
  adapted to one event union (thinking, text, plan, tool_call/update, usage,
  permission, error, done) so the transparency engine and renderer stay
  host-agnostic. Permission decisions use one host-agnostic vocabulary
  (`allow` | `allow_always` | `reject`) that each adapter maps to its protocol.
- **Adapters.** OpenCode is driven over its headless HTTP server + `/event` SSE
  bus (`lib/chat/harness/opencode-adapter.mjs`); any native ACP agent (e.g.
  Gemini) is driven over JSON-RPC stdio (`lib/chat/harness/acp-client.mjs`).
  Claude and Codex are registered and detected but their adapters are pending.
- **Transparency engine (`lib/chat/transparency.mjs`).** Resolves which layers
  are visible (transparency-first: all on, opt-out via `--no-*`) and, before a
  turn, derives the specialist route `orchestration-policy.mjs` would select so
  the planned path is shown next to the host's actual execution.
- **Accessible renderer (`lib/chat/tui/render.mjs`).** Linear, label-first
  output (color is enhancement only), honoring `NO_COLOR`/non-TTY, with
  interruptible turns. The normalized timeline persists to
  `.cx/chat-sessions/<id>.jsonl` for later replay.

## Rationale

Delegating the loop keeps Construct on the right side of every prior boundary:
ADR-0001 (zero-dep core — the OpenCode adapter uses `fetch` + a hand-rolled SSE
reader, not the vendor SDK), ADR-0022 (host is a thin client), and ADR-0039
(CLI is the substrate; this is a TUI emphasis, not a new runtime). The
transparency overlay is the differentiator the existing host CLIs structurally
cannot offer, because they do not own Construct's routing policy.

Resolving hosts by probing real binaries — rather than assuming a fixed command
or a single vendor — is what makes the surface honest about diverse machine
setups (shell-function wrappers, `op run`, version managers, multiple installed
agents) instead of failing on the first non-standard install.

## Rejected alternatives

- **Build Construct's own agent loop.** Rejected: duplicates the host runtimes,
  contradicts ADR-0022 and the no-IDE non-bet, and couples Construct to model
  providers it deliberately abstracts.
- **OpenCode-only, hardcoded.** Rejected: the user base runs Claude, Codex,
  Gemini, and OpenCode in varied configurations; a single hardcoded host fails
  the agnosticism goal. The registry keeps OpenCode first without locking out
  the rest.
- **ACP-only.** Rejected as the sole path: not every capable host speaks ACP
  today (OpenCode's first-class interface is its HTTP/SSE server). ACP is the
  preferred generic path; per-host adapters cover the rest behind one contract.

## Consequences

- A new `construct chat` command (Models & Integrations tier) and a `lib/chat/`
  subsystem, all behind the normalized driver contract.
- Adding a host is a registry edit plus one adapter implementing the contract.
- Live model round-trips depend on the host's own credentials/config; Construct
  starts or attaches to the host but never handles host secrets.
- Claude and Codex adapters remain to be implemented; the registry marks them
  pending so resolution never routes to an unbuilt adapter.

## Reversibility

Two-way door. `construct chat` and `lib/chat/` are additive; removing them leaves
the CLI substrate, the ACP agent (ADR-0023), and all other surfaces unchanged.

## References

- ADR-0001 (zero-npm-core), ADR-0022 (orchestration daemon — thin clients),
  ADR-0023 (ACP agent), ADR-0030 (chain-of-thought disclosure),
  ADR-0039 (interaction-surface model)
- `lib/chat/**` (hosts, transparency, harness drivers, TUI renderer, CLI)
- `lib/orchestration-policy.mjs` (planned specialist route overlay)
