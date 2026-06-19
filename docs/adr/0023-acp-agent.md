<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0023: Construct as an ACP (Agent Client Protocol) server — first-class native editor integration

- **Date**: 2026-06-04
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

> **Note (2026-06):** ADR-0041 retired the terminal chat **delegate/ACP client adapter** path. Standalone ACP **server** scope in this ADR remains proposed and deferred.

<!-- Owning specialist: cx-architect. Part of the host-independent orchestration runtime (epic construct-pdx0). -->

## Problem

MCP makes orchestrated outcomes *reachable* on every host (ADR-0022), but in editors that have adopted the Agent Client Protocol (ACP) — Zed, JetBrains, the VS Code ACP client — an MCP tool is a second-class citizen: it surfaces as a tool call inside whatever agent the editor already runs, not as a selectable agent. To be a first-class native agent in those editors, Construct must speak the protocol the editor uses to drive agents directly.

## Context

ACP (agentclientprotocol.com) is the 2026 editor↔agent standard — JSON-RPC 2.0 over stdio, with a shared registry and 25+ participating agents. It is the "LSP for agents": any ACP client can drive any ACP server. The core flow is `initialize` (version + capabilities), `session/new` (returns a `sessionId`), `session/prompt` (content blocks in, streamed `session/update` notifications, a terminal `stopReason`), and `session/cancel`. Construct already owns the orchestration engine (ADR-0020/0021) and exposes it as a daemon (ADR-0022) and an MCP tool; ACP is a third front-end over the same engine, not a new engine.

## Decision

Ship an ACP server (`lib/acp/server.mjs`, `construct acp`) that speaks newline-delimited JSON-RPC 2.0 on stdio. `session/prompt` bridges to the orchestration runtime: `planRun` then `executeRun`, forwarding run-lifecycle events from the process-local event bus (`lib/orchestration/events.mjs`) as `session/update` agent-message chunks, and returning `stopReason: end_turn` (or `cancelled`/`refusal`). The engine remains the single owner of orchestration; the ACP client is a thin front-end exactly like the daemon's HTTP clients and the MCP tool. The default worker backend keeps a run hermetic; `provider` delivers real specialist output.

## Rationale

ACP is the field-proven editor-integration path (Zed shipped it; JetBrains and a VS Code client followed; Gemini CLI, Codex, OpenCode implement ACP servers). Implementing the server makes Construct a selectable native agent in those editors with no per-editor code, reusing the runtime and event bus already built. JSON-RPC over stdio is dependency-free (Node `readline`), so the server adds no runtime weight.

## Rejected alternatives

- **MCP-only.** Rejected as the *only* path: MCP reaches every host (and remains the equalizer for non-ACP hosts), but it cannot present Construct as a first-class agent in ACP editors.
- **A bespoke extension per editor.** Rejected: duplicates effort per editor and is exactly what ACP exists to avoid.
- **A2A (agent↔agent).** Deferred: A2A targets agent-to-agent federation, not editor↔agent; revisit after ACP.

## Consequences

ACP editors drive Construct natively; an `initialize`→`session/new`→`session/prompt` handshake runs a real multi-specialist orchestration and streams progress. The surface is additive (a new module + a new CLI verb); removing it leaves the daemon, MCP tool, and in-process runtime untouched. Client-provided `fs/*` and `terminal/*` capabilities, richer `session/update` variants (plan, tool calls), and ACP registry submission are follow-ups.

## Reversibility

Two-way door. `lib/acp/server.mjs` + the `construct acp` verb are isolated; the event bus is process-local and stateless. Reverting removes one front-end and changes nothing else.

## References

- `lib/acp/server.mjs`, `bin/construct` (`acp`), `lib/orchestration/runtime.mjs` (`planRun`/`executeRun`), `lib/orchestration/events.mjs`
- `tests/functional/acp-server.functional.test.mjs` (binding)
- ADR-0020 (local runtime), ADR-0021 (provider worker), ADR-0022 (orchestration daemon)
- Agent Client Protocol — agentclientprotocol.com (2026-06-03)
- GH #215 (host-aware orchestration / parity)
