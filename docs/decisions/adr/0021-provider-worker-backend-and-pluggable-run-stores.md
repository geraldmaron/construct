<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0021: The orchestration runtime gains a provider worker backend that executes specialist reasoning, and pluggable run stores

- **Date**: 2026-06-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none (this ADR partially refines the prior runtime decision for the provider backend only — see Decision; the prepare-only boundary stays in force for the inline backend)
- **Status note (2026-06-29, self-audit construct-rr63.1.2)**: shipped and test-covered — implemented by `lib/orchestration/worker.mjs` (`runTaskViaProvider`) and `lib/orchestration/store.mjs` (`resolveRunStore`) with `tests/orchestration-run-store-sqlite.test.mjs` and `tests/orchestration-run-store-postgres.test.mjs`. Status corrected from `proposed` to reflect ground truth.
- **Status note (2026-07, construct-5wkl)**: hardened the provider backend's failure handling within this ADR's existing boundary (a provider failure is recorded `status: 'failed'`, never crashes the run) — a 2xx transport response with unusable content (empty, content-filtered, reasoning-only, malformed) now classifies into the same typed-error path as a transport failure, with a bounded retry/backoff policy for genuinely transient outcomes and redacted per-task provider telemetry. See `docs/guides/reference/provider-worker-reliability.md` for the full failure-mode/remediation table; no boundary or contract in this ADR changed.

<!-- Owning specialist: cx-architect. Part of the host-independent local orchestration runtime (epic construct-d6pf). -->

## Problem

ADR-0020 shipped the local orchestration runtime with a single `inline` worker backend that prepares specialist tasks but does not perform specialist reasoning, and a single filesystem run store. That was the honest Mode-A slice. Two gaps remained for full host independence: a host with no native multi-agent execution still cannot get Construct to actually run a specialist chain (the inline backend stops at preparation), and team/enterprise deployments have no shared, durable run store — the filesystem store is per-machine. Without these, a non-Claude host reaches a prepared task graph but never executed specialist output, and multiple processes cannot observe the same run.

## Context

The substrate to close both gaps already exists. `lib/ingest/provider-extract.mjs` establishes the provider-call conventions (Anthropic `/v1/messages` for Claude-family models, OpenRouter `/v1/chat/completions` otherwise; structured error codes; injectable `fetchImpl`; hermetic-when-explicit key resolution). The execution contract (`resolveExecution`, ADR-0019) already resolves and persists `selectedModel`/`selectedProvider` on each run. `lib/intake/postgres-queue.mjs` and `lib/storage/backend.mjs` (`createSqlClient`) establish the team/enterprise Postgres pattern, and `node:sqlite` (`DatabaseSync`) offers a zero-install single-file daemon store on Node >=22.5. The runtime already reports `workerBackend` and per-task `executor`, so adding a backend that executes is observable rather than hidden.

## Decision

Extend the orchestration runtime with two pluggable axes behind unchanged callers.

**(a) A `provider` worker backend that executes specialist reasoning.** `lib/orchestration/worker.mjs` exports `runTaskViaProvider`, which calls the configured provider/model with the specialist persona prompt as system context and the run request as the user turn, returning the model's real output. `executeRun` gains a `workerBackend` option: with `provider`, each task is executed and reaches status `done` carrying `task.output` and `executor='provider:<provider>:<model>'`; a provider failure is recorded (status `failed`, `task.error`) and the run completes `completed-with-failures` rather than crashing. This **supersedes ADR-0020's prepare-only boundary for the provider backend only**. The `inline` backend is unchanged and remains the default: it still prepares (status `prepared`, `executor='inline:prepared'`), and the prepare-only disclaimer still applies to inline tasks. Because the provider backend genuinely executes the model, recording its output as `task.output` is not fabrication — the descriptive disclaimer does not apply to provider-executed tasks, and the runtime's semantics string is precise about which backend did what.

**(b) Pluggable run stores behind one interface.** `lib/orchestration/store.mjs` (`resolveRunStore`) returns a `{ saveRun, loadRun, listRuns }` store bound to one of three backends: filesystem (Mode-A default), sqlite (Mode-B, `node:sqlite`), or postgres (Mode-C, shared team/enterprise). Selection precedence is explicit config (`orchestration.store`) / `CONSTRUCT_ORCHESTRATION_STORE` env override, else deployment mode (solo→filesystem, team/enterprise→postgres). An unavailable backend (sqlite on Node <22.5, or postgres with no reachable `DATABASE_URL`) falls back to filesystem with a recorded warning. The runtime resolves its store through this resolver instead of importing filesystem functions directly, but filesystem stays the default so the Mode-A run record is byte-for-byte unchanged.

## Rationale

The provider backend is the capability that makes host independence real: a host that cannot run subagents natively can now have Construct execute the specialist chain end to end, with the same planning/sequencing/handoff/observability the inline backend already owns. Isolating it as a separate, explicitly-selected backend — rather than changing what inline does — keeps the honest default intact and confines model spend and failure modes to an opt-in, explicitly-named path. Pluggable stores let the same runtime serve a solo developer (no dependency) and a team (shared Postgres) without a code change, exactly as the intake queue already does. Lazy-loading `node:sqlite` and probing availability keeps the Node 20 CI matrix green without statically importing a builtin that does not exist there.

## Rejected alternatives

- **Make the inline backend call the model.** Rejected: it would erase the honest prepare-only default and conflate the control plane with the worker execution plane. The provider backend is opt-in and named in the run's `workerBackend` field instead.
- **Require Postgres for the provider backend or for any shared run state.** Rejected: it raises the floor for solo/editor users; the filesystem and sqlite tiers cover the no-infrastructure cases, and the resolver degrades gracefully.
- **Statically import `node:sqlite`.** Rejected: it would crash module load on Node 20. The lazy probe (`sqliteAvailable()`) is the correct mechanism.
- **Spawn container workers for Mode-C now.** Out of scope: AC6 frames container-worker spawning as optional. The Postgres run store is the shipped Mode-C deliverable; container orchestration is a later increment.

## Consequences

A non-Claude host can drive a fully executed specialist chain through Construct and receive real per-task output, while the default inline path stays prepare-only and honest. Runs can persist to filesystem, sqlite, or postgres without changing callers, and team/enterprise deployments share durable runs. The provider backend introduces model cost and external-call failure modes, both confined to the opt-in `orchestration.workerBackend='provider'` path and surfaced as structured per-task errors and a `completed-with-failures` run status. Node <22.5 transparently falls back from sqlite to filesystem.

## Reversibility

Two-way door. Both axes are additive: removing the provider backend leaves the inline default untouched, and removing a store backend leaves the filesystem default and its data intact. The store interface is the same load/save surface ADR-0020 anticipated, so backends are swappable without caller changes.

## References

- `lib/orchestration/worker.mjs`, `lib/orchestration/store.mjs`, `lib/orchestration/run-store-sqlite.mjs`, `lib/orchestration/run-store-postgres.mjs`, `lib/orchestration/runtime.mjs`, `lib/orchestration/run-store.mjs`
- `lib/ingest/provider-extract.mjs`, `lib/intake/postgres-queue.mjs`, `lib/storage/backend.mjs`, `lib/config/schema.mjs`
- `tests/orchestration-worker.test.mjs` (binding), `tests/orchestration-run-store-sqlite.test.mjs`, `tests/orchestration-run-store-postgres.test.mjs`, `tests/orchestration-store-resolver.test.mjs`
- ADR-0019 (execution-capability descriptive contract), ADR-0020 (local orchestration runtime; prepare-only inline boundary)
- GH #207 (host-independent local orchestration runtime)
