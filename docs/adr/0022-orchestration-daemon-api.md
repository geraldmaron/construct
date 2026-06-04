<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0022: Orchestration engine-as-service — a local HTTP+SSE API so any host reaches Construct-equivalent outcomes

- **Date**: 2026-06-04
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

<!-- Owning specialist: cx-architect. Part of the host-independent orchestration runtime (epic construct-pdx0). -->

## Problem

A developer in VS Code asks for multi-specialist work and gets only a plan, not the orchestrated result, because Construct relied on the host's agent loop to execute and editor hosts (VS Code/Copilot, Cursor) have no extension-facing subagent primitive. We had been answering this with an elaborate execution-capability negotiation (ADR-0019/0020/0021) that *reported* degradation rather than *delivering* the outcome.

## Context

Primary-source research (2026-06-03) shows every tool that delivers true multi-agent inside VS Code — Claude Code, OpenCode, Goose — uses the same shape: **the engine owns orchestration; the editor is a thin client** over a CLI/daemon (HTTP/SSE) or MCP. The editor's missing subagent primitive is immaterial when the engine runs the loop. Construct already owns that engine — the local orchestration runtime (ADR-0020/0021): `planRun`/`executeRun` with a provider worker that genuinely executes specialists, and a pluggable run store. What was missing was a way for thin clients to drive it and stream results. Construct also already ships a local HTTP server (`lib/server/index.mjs`, vanilla Node `http`, `127.0.0.1`, token auth, an SSE channel) — so the daemon is an extension of existing infrastructure, not a new service.

## Decision

Expose the orchestration runtime over the existing local server as a typed `/api/orchestration/*` surface: `POST /runs` starts a run in the **background** (returns `runId` immediately), `GET /runs/:id` and `GET /runs` inspect, `GET /runs/:id/events` streams the run's lifecycle over **SSE**, and `POST /runs/:id/cancel` requests a cooperative between-task stop. A process-local event bus (`lib/orchestration/events.mjs`) is the streaming primitive (durable history stays in the run store + trace log). Runs execute via the configured worker backend — `provider` to deliver real specialist output, `inline` to prepare. Every response is wrapped in the versioned, secret-free embedded-contract envelope; requests are gated by the existing dashboard auth, and a CSRF exemption for `Authorization`-header requests lets programmatic clients (editors/CLI/CI) call the API without the browser CSRF dance. Hosts are thin clients (a `construct orchestrate run --remote` CLI client ships as the reference).

## Rationale

This is the field-proven architecture (OpenCode's server + thin clients; Claude Code's CLI engine + thin extension). It makes orchestrated outcomes attainable on *any* HTTP/MCP-capable host without reimplementing an agent loop per editor, reuses the runtime and server Construct already built, and keeps the engine the single owner of orchestration. Background execution + start/stream/poll fits long multi-specialist runs that exceed a single request's patience. It also dissolves the host-vs-runtime capability negotiation: orchestration *works* server-side, so there is little left to gate.

## Rejected alternatives

- **Reimplement the agent loop inside a VS Code extension** (the Cline/Roo pattern). Rejected: duplicates the engine, bounded by the editor's single-threaded extension host (no real parallelism), and must be rebuilt per editor.
- **Pure MCP tool surface only.** Rejected as the primary path: MCP tool calls are request/response with optional progress, a poor fit for long detached runs; the HTTP+SSE daemon is the richer substrate (MCP can still front it later).
- **Block the HTTP request until the run completes.** Rejected: multi-specialist runs exceed reasonable request lifetimes; start-job + stream/poll is the durable contract.

## Consequences

Any thin client — a VS Code extension, OpenCode, CI, the bundled `--remote` CLI — can trigger a real multi-specialist run and receive the outcome, the same outcome a Claude Code user gets, with no host subagent primitive. The daemon is loopback-bound and auth-gated; the `Authorization`-header CSRF exemption is a general, correct improvement (CSRF defends cookie auth, not header tokens). Because the daemon is a long-lived, detached service not bound to one project, it persists runs under the user data root (`~/.cx/runtime/orchestration/`) rather than the install directory — the install dir can be shared or read-only across projects, whereas HOME is always writable and survives reinstalls. This is a single-user-daemon model; per-project run stores and multi-host sharing (Mode-C Postgres) are follow-ups. A full VS Code extension and ACP/cross-editor protocol adoption are also follow-ups; the API is the prerequisite.

## Reversibility

Two-way door. The surface is additive (new routes on the existing server, a new event module, a new CLI flag); removing it leaves the in-process runtime and the rest of the server untouched. The event bus is process-local and stateless.

## References

- `lib/server/index.mjs` (`/api/orchestration/*`), `lib/orchestration/events.mjs`, `lib/orchestration/runtime.mjs` (`startRun`), `lib/server/csrf.mjs`
- `tests/functional/orchestration-server.functional.test.mjs` (binding), `tests/orchestration-events.test.mjs`
- ADR-0019 (execution-capability contract), ADR-0020 (local runtime), ADR-0021 (provider worker + run stores)
- GH #215 (host-aware orchestration / parity)
