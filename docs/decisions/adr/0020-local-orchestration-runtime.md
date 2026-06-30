<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0020: Construct owns a local orchestration runtime; the Mode-A backend prepares, it does not fake, specialist execution

- **Date**: 2026-06-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Status note (2026-06-29, self-audit construct-rr63.1.2)**: shipped and test-covered — implemented by `lib/orchestration/runtime.mjs` (+ `run-store.mjs`, `worker.mjs`) with `tests/functional/orchestration-mode-a.functional.test.mjs` and `tests/orchestration-runtime.test.mjs`. Status corrected from `proposed` to reflect ground truth.

<!-- Owning specialist: cx-architect. Part of the host-independent local orchestration runtime (epic construct-d6pf). -->

## Problem

Construct's best orchestration behavior has been coupled to whichever host exposes the strongest native multi-agent runtime: Claude Code can act like a full multi-agent system, while editor hosts (VS Code/Copilot, Cursor) behave more like prompt/profile surfaces. That makes parity a host accident rather than a product capability — a user selecting Construct in two hosts cannot expect equivalent outcomes, and embedders must invent their own fallback logic and UX wording.

## Context

The control-plane substrate already exists: `orchestration-policy.mjs` (`routeRequest`) plans/decomposes a request into a sequenced specialist chain headlessly; `embedded-contract/execution.mjs` (`resolveExecution`, ADR-0019) resolves the execution-capability contract; `host-capabilities.mjs` classifies host orchestration; `worker/trace.mjs` emits lifecycle traces; the project `.cx/` tree is the canonical durable local store. What is missing is a Construct-owned runtime that ties these into a durable, observable, resumable run that a thin host adapter can drive — without requiring Docker, a database, or host-native subagents. The honesty constraint mirrors ADR-0019: a runtime that *claims* to have executed specialist reasoning it did not perform would fabricate.

## Decision

Add a Construct-owned local orchestration runtime (`lib/orchestration/runtime.mjs` + `run-store.mjs`) exposed as `construct orchestrate run|status [--json]`. Mode-A is the zero-dependency tier: single-process, filesystem-backed run/task store under `.cx/runtime/orchestration/`, no Docker. It intakes a request, plans a sequenced specialist chain, resolves the execution contract, and persists a durable run with a task lifecycle (`queued → running → prepared`) plus lifecycle traces. The Mode-A worker backend is `inline`: it **owns** planning, sequencing, handoff state, persistence, and observability, and **prepares** each specialist task (role, reason, handoff contract) for a downstream executor. It does **not** perform specialist LLM reasoning — a provider-backed worker backend is a separate, later backend. Runs report `workerBackend` and per-task `executor`, and when the execution contract resolves to prompt-only or host-direct the run owns no specialist sequence and records that explicitly.

## Rationale

Owning the control plane is the missing product capability — Postgres/Docker support state and durability but do not decide who plans, dispatches, tracks handoffs, and reports effective capability. A filesystem Mode-A tier makes the runtime usable for solo/editor workflows with no infrastructure, while the same load/save and worker-backend surfaces leave room for Mode-B (SQLite daemon) and Mode-C (Postgres/containers) without changing callers. Shipping the inline backend honestly — prepare, don't fake — delivers real multi-step coordination (sequencing, handoff state, resumability, observability) now, and isolates the model-backed worker as the next increment, exactly as ADR-0019 separated planned capability from observed execution.

## Rejected alternatives

- **Require Docker/Postgres for host parity.** Rejected: it raises the floor for solo/editor users and still does not supply orchestration ownership — the actual gap.
- **Have the inline backend call a model and emit specialist output now.** Rejected for this slice: it conflates the control plane with the worker execution plane and risks fabricating specialist reasoning without an explicit, tested provider-worker contract; the boundary is deferred to a provider-backed backend.
- **Keep depending on host-native subagents for the best experience.** Rejected: that keeps Construct a host skin and makes parity unachievable without changing hosts.

## Consequences

A non-Claude host can drive multi-step specialist coordination through a Construct-owned runtime and receive structured host-adapter metadata (`executionMode`, `constructCapabilitiesActive`, `workerBackend`, `hostRole`, `degraded`, `degradationReason`, …). Runs survive host/editor restarts and are inspectable via `orchestrate status`. The provider-backed worker backend (actual specialist reasoning) and the Mode-B/C tiers are follow-ups; the prepared-task boundary is explicit in the run output and docs, so a host cannot mistake preparation for execution.

## Reversibility

Two-way door. The runtime is additive (new modules, a new command, a new `.cx/runtime/orchestration/` store); removing it leaves the existing surfaces untouched with no data loss. The Mode-A filesystem store is an implementation detail behind the load/save surface, replaceable by SQLite/Postgres without changing callers.

## References

- `lib/orchestration/runtime.mjs`, `lib/orchestration/run-store.mjs`, `lib/orchestration-policy.mjs`, `lib/embedded-contract/execution.mjs`, `lib/host-capabilities.mjs`, `lib/worker/trace.mjs`
- `tests/orchestration-runtime.test.mjs` (binding), `tests/functional/orchestration-mode-a.functional.test.mjs`
- ADR-0019 (execution-capability descriptive contract)
- GH #207 (host-independent local orchestration runtime)
