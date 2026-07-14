# ADR-0078: A checkpointer-style durable-handoff abstraction for the orchestration runtime

- **Date**: 2026-07-14
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none

## Problem

Construct's orchestration runtime executes a specialist chain but cannot durably resume one mid-flight. `executeRun` (`lib/orchestration/runtime.mjs`) loads a run, iterates `run.tasks` start to finish, and — for the in-process solo backend — dies silently if the process dies (`runMode: 'in-process'`; "process death silently kills the run"). There is no `orchestrate resume`: a run interrupted after the architect and engineer completed but before the reviewer ran cannot be continued from that boundary; it must be re-driven from the top, re-spending on the tasks that already succeeded. The same gap blocks resumable human-in-the-loop — an approval pause today lives only in an in-session token, not on any durable record a second process could pick up.

## Context

The org-capability audit's external-framework survey (`docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md`, R1) found this to be the single largest capability gap the field exposes, and found that every mature framework converges on one shape to close it: snapshot state at a step boundary, store it behind a pluggable backend, resume by an id.

- **LangGraph** (MIT, `1.2.9` 2026-07-10) is the reference implementation: a **checkpointer** snapshots per superstep, ships in-memory / Postgres / SQLite savers, resumes by `thread_id`, and — notably — the *same* mechanism powers its human-in-the-loop interrupts.
- **CrewAI** `@persist` (UUID snapshot, resume-vs-fork, SQLite default), **PydanticAI** durability-as-a-pluggable-concern (Temporal / DBOS / Prefect / Restate), and **Google ADK**'s pluggable `SessionService` (memory / DB / Vertex) are the same pattern behind different names.
- The HITL shape is the same protocol again — serialize → approve → resume: OpenAI Agents SDK `RunState` serialize/deserialize, PydanticAI `DeferredToolRequests`/`DeferredToolResults`, LangGraph interrupt-on-checkpoint (fit-matrix §4).

Construct is already partway there and should not rebuild what exists. The run store (`lib/orchestration/store.mjs`, `run-store.mjs`) already writes the whole run record — task chain, per-task status/output, participation, contract status — as JSON after every task via `store.saveRun`, across three backends (filesystem / sqlite / postgres). What is missing is not the snapshot; it is (1) a resume entry point that re-enters `executeRun` at the first non-terminal task rather than the top, and (2) a first-class, serializable *pause* state (awaiting-approval / awaiting-host) that the resume path treats as a checkpoint rather than a dead end. This ADR is a design decision, not a rewrite; it amends the ADR-0065 (orchestrator-worker consolidation) / ADR-0067 (deterministic flow engine) lineage rather than replacing it.

## Decision

Adopt a checkpointer-style durable-handoff abstraction over the existing run store, native to Construct (borrowed pattern, not a dependency):

1. **Checkpoint boundary = handoff boundary.** The existing per-task `saveRun` becomes the explicit checkpoint: the run record at each task boundary is the resumable snapshot. No new store is introduced; the checkpoint is the run JSON already written, with the task chain as the superstep sequence.
2. **Resume by `runId`.** A new `resumeRun(runId)` re-enters `executeRun` at the first task whose status is not terminal (`queued`/`running`-orphaned), skipping completed tasks and re-materializing the next prompt from the persisted upstream outputs (the H6a prior-results mechanism already reconstructs downstream context from stored outputs). A CLI/MCP `orchestrate resume` surfaces it.
3. **Pause is a checkpoint, not a terminal.** `awaiting-host` and a future `awaiting-approval` become serialized pause states on the run record — the same durable snapshot — so a resumable HITL approval is `resumeRun` applied to an approval-gated checkpoint, unifying the durable-handoff and approval-gate work the fit-matrix flagged as one problem (§3, §4).
4. **Backend stays pluggable.** The three existing run-store backends are the checkpointer's savers; no new persistence infrastructure. Team/enterprise durability (a claimed, heart-beated worker rather than fire-and-forget in-process) is a separate, later concern this abstraction is compatible with.

## Rationale

The pattern is convergent across five independent, mature frameworks — that convergence is the evidence it is the right shape, not any single implementation. Building it over the store that already snapshots every boundary is low-risk and additive: a resume path that reads existing records cannot regress a run that never resumes. Unifying pause and checkpoint means one mechanism serves both durability and resumable HITL, which is exactly how LangGraph and the OpenAI SDK structure it.

## Rejected alternatives

- **Depend on LangGraph / Temporal / DBOS directly.** Rejected per the audit's own guardrail — no external framework becomes a core dependency without its own benchmark + threat analysis + ADR, and all are Python-first while Construct's runtime is Node. Borrow the pattern, not the package.
- **Full external durable-execution engine (Temporal-style) now.** Rejected as premature: solo in-process runs are the common case; a resume path over the existing store closes the observed gap without standing up a workflow engine.
- **Leave resume unbuilt, re-drive from the top.** Rejected: re-driving re-spends on already-successful tasks and makes cross-process HITL impossible — the two concrete failures this ADR addresses.

## Consequences

- Positive: an interrupted run resumes by id without re-spending; HITL approval becomes durable and cross-process; the checkpointer unifies with the deterministic flow engine (ADR-0067) rather than competing with it; Construct gains the one pattern every surveyed framework has, on its own terms.
- Negative / cost: resume must reconcile orphaned `running` tasks (a task the dead process left mid-flight) — the resume path needs an explicit "was this task actually completed?" check, not a blind continue. Pause-as-checkpoint adds states the terminal-status taxonomy (ADR-0079) must account for.
- Follow-up: this is a proposal; implementation is a bounded bead behind it, gated on the terminal-status alignment (ADR-0079) so pause states share one vocabulary.

## Reversibility

High for the resume path (additive; deleting `resumeRun` leaves start-to-finish execution unchanged). Moderate for pause-as-checkpoint once HITL depends on it. No data migration: the checkpoint is the run record already written.

## References

- `docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md` §3–§4 and the framework rows (LangGraph, CrewAI, PydanticAI, ADK, OpenAI Agents SDK)
- ADR-0065 (orchestrator-worker consolidation), ADR-0067 (deterministic flow engine) — the lineage this amends
- ADR-0079 (terminal-status vocabulary alignment) — shares the pause-state vocabulary
- `lib/orchestration/runtime.mjs` (`executeRun`, `run.runMode`), `lib/orchestration/store.mjs` / `run-store.mjs` (the existing per-boundary snapshot)
