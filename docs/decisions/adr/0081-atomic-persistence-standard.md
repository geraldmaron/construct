# ADR-0081: Atomic persistence is the mandatory standard for durable JSON/JSONL state

- **Date**: 2026-07-16
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.3` (ADR-C, atomic persistence standard) from the continuous-work audit's ADR-beads table in `docs/notes/research/2026-07-continuous-work-audit/target-architecture.md`

## Problem

Two of the system's cross-process durable state stores — the write-intent sent-log (the only idempotency-dedup record for external writes) and the embed approval queue — persisted via a full-file `writeFileSync` rewrite with no temp-file/rename step. A crash mid-write left a truncated or corrupt file; for the sent-log, a dropped persist was also silently swallowed (bare `catch {}`), losing the idempotency key and risking a duplicate external mutation on retry (e.g. a Jira comment or Slack message sent twice). `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 19 and 20 graded both `contradicted`. Meanwhile `lib/flows/checkpoint.mjs` already implemented a genuinely atomic temp-file-then-rename pattern — row 31 of the same matrix calls it "Only genuinely atomic (temp+rename) persistence in the entire system" — the fix already existed in the codebase, it just wasn't applied consistently.

## Context

`target-architecture.md`'s entity-mapping table maps the "Run" entity onto the flow engine's `createRun`/`advanceRun` plus checkpoint persistence and says explicitly: "the one genuinely atomic subsystem in the codebase... Reuse its persistence pattern for Run state everywhere." The same document's ADR-beads table scopes ADR-C to exactly this — "Atomic persistence standard (adopt checkpoint.mjs temp+rename pattern everywhere)" — owned by "Audit" (an engineering fact, not a product choice) and named on the critical path alongside ADR-D as unblocking every P0 bead in the continuous-work program.

Earlier in this same session, before this ADR was drafted, the fix was already applied at both flagged sites: `lib/writes/sent-log.mjs` (commit `b6dc4bce`, "fix(writes): make sent-log persist atomic and surface errors") and `lib/embed/approval-queue.mjs` (commit `deba1a90`, "fix(embed): atomic approval-queue persist + cross-process dedup"), both on branch `feat/wjap9-p1.2-graph-vocabulary`. Reading the actual diffs (`git show --stat b6dc4bce`, `git show --stat deba1a90`) and the resulting files confirms both now use the identical `${path}.${pid}.${counter}.tmp` write + `renameSync` shape as `checkpoint.mjs`'s `atomicWriteJson`, and both shipped with new fault-injection/concurrency tests (`tests/writes/sent-log.test.mjs`, `tests/embed-approval-queue-concurrency.test.mjs`). This ADR therefore ratifies a decision already implemented at both P0 sites — it does not propose new work there. Its job is to make the pattern the mandatory standard going forward and to inventory what else in the codebase still needs it.

A grep of `lib/**/*.mjs` (excluding tests) for `writeFileSync` found roughly 170 files performing some form of file write. Of those, 16 already pair it with `renameSync` in the same file (temp+rename): `lib/flows/checkpoint.mjs`, `lib/writes/sent-log.mjs`, `lib/embed/approval-queue.mjs`, `lib/orchestration/run-store.mjs`, `lib/graph/store.mjs`, `lib/orchestration/build-audit-record.mjs`, `lib/intake/git-queue.mjs`, `lib/intake/manifest.mjs`, `lib/context-state.mjs`, `lib/embed/cli.mjs`, `lib/embed/conflict-detection.mjs`, `lib/embed/customer-profiles.mjs`, `lib/embed/workspaces.mjs`, `lib/engine/consolidate.mjs`, `lib/init-docs.mjs`, `lib/scopes/lifecycle.mjs` — so the pattern has organically spread well beyond the two sites this session touched. The remaining ~154 files do a raw single-`writeFileSync` rewrite. Most are one-shot, single-writer config/scaffold files (setup wizards, init templates, demo-project generation) where the risk is low. A spot-check, however, surfaced several genuine durable-state stores in the same risk class as sent-log/approval-queue — see Consequences.

## Decision

Adopt `lib/flows/checkpoint.mjs`'s `atomicWriteJson` temp-file-then-rename pattern (write to `${filePath}.${pid}.${writeCounter}.tmp` in the same directory, then `renameSync` onto the real path) as the mandatory standard for any durable, crash-safe JSON/JSONL persistence in this codebase — effective immediately for new code, and as the target shape for remediating existing non-atomic durable-state stores.

Concretely: any module persisting state that (a) survives process restart, (b) participates in dedup/idempotency, a queue, a ledger, or an audit trail, or (c) can be written by more than one process/instance, must use temp+rename; if the store services concurrent readers/writers it must also reload from disk before any dedup or uniqueness check, per the `enqueue()` fix in `approval-queue.mjs`. One-shot, single-writer config/scaffold files are out of scope for this standard — their risk profile doesn't justify the added complexity.

Options considered:
1. **Adopt `checkpoint.mjs`'s pattern directly — recommended.** Already implemented twice this session, with passing fault-injection/concurrency tests proving the crash-mid-write and cross-process-duplicate-enqueue cases are actually closed.
2. **Adopt SQLite for these stores.** Gives real transactions instead of manual temp-file bookkeeping; explicitly deferred (see Rejected alternatives) as a bigger migration — not rejected outright.
3. **Leave as-is.** Rejected — this was a P0-severity defect class (silent data loss / duplicate external mutations).

## Rationale

`checkpoint.mjs`'s pattern is already proven in production use: it's the flow engine's crash-safe Run persistence, graded `production-usable` / "Honest" in the truth-matrix (row 31), and `target-architecture.md` independently converges on the same module as the reuse target for Run state generally. Applying the identical pattern to sent-log and approval-queue this session required no new design — the twelve-line `atomicWriteJson` shape, a write-counter for same-tick uniqueness, and (for approval-queue specifically) reload-before-dedup to close the cross-process race. Standardizing now, while the pattern is proven and two real examples exist in the tree, costs nothing beyond documenting it as mandatory; deferring risks the next durable-state module reinventing — or skipping — crash safety from scratch.

## Rejected alternatives

- **Adopt SQLite (or another embedded DB) for these stores.** Gives real transactions instead of manual temp-file bookkeeping, but is a materially larger migration — schema, query layer, data migration for existing JSONL. Not rejected outright: `lib/orchestration/store.mjs` already supports a sqlite/postgres backend for orchestration runs (truth-matrix row 32), so there's precedent in this codebase. Explicitly deferred rather than decided against; a future ADR can revisit per-store if operational pain, not just a theoretical durability gain, justifies the migration cost.
- **Leave as-is (raw `writeFileSync` rewrite).** Rejected. truth-matrix rows 19 and 20 graded this `contradicted` — a P0-severity defect class: a torn write on crash, or a silently swallowed persist error, meant a lost idempotency key and a real risk of duplicate external mutation on retry. Closing this is a precondition for target-architecture.md's Action Plane becoming "the single mandatory path for every external mutation."

## Consequences

- Positive: one documented, tested pattern for crash-safe persistence instead of each module inventing its own; the two most acute idempotency-critical stores (sent-log, approval-queue) are already fixed and tested; `target-architecture.md`'s Run-entity reuse guidance and this ADR now agree explicitly.
- Negative / cost: applying the pattern retroactively to every remaining durable-state store is unstarted work, not scoped or estimated by this ADR — it sets the standard, it does not schedule the remediation.
- Not yet covered — found by grepping `lib/` for `writeFileSync` without a paired `renameSync`, not fixed this session, blast radius `[unverified]` (none of these were graded in the truth-matrix pass): `lib/cost-ledger.mjs`, `lib/oracle/verdicts.mjs`, `lib/observation-store.mjs`, `lib/entity-store.mjs`, `lib/session-store.mjs`, `lib/intake/filesystem-queue.mjs`, `lib/intake/quarantine.mjs`, `lib/task-graph/store.mjs`, `lib/contracts/violation-log.mjs`, `lib/strategy-store.mjs`, `lib/knowledge/research-store.mjs`, `lib/improvement/store.mjs`, `lib/read-tracker-store.mjs` — plus roughly 140 other single-writer config/scaffold sites not individually triaged here.
- Follow-up: a bead to triage the "not yet covered" list above (durable cross-process state vs one-shot config) and schedule remediation for the durable-state subset, prioritized by idempotency/concurrency exposure the same way sent-log and approval-queue were.

## Reversibility

High: this is a coding-pattern standard, not a data-format or API change. Adopting or reverting it at any given call site is a local, mechanical edit (swap `writeFileSync` for the temp+rename helper, or back) with no migration of existing on-disk data required either direction.

## References

- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 19 (sent-log, contradicted), 20 (approval-queue, contradicted), 31 (checkpoint.mjs, production-usable — "Only genuinely atomic (temp+rename) persistence in the entire system")
- `docs/notes/research/2026-07-continuous-work-audit/target-architecture.md` — "Run" entity row ("the one genuinely atomic subsystem in the codebase... reuse its persistence pattern for Run state everywhere"), ADR-C row, critical-path note
- `lib/flows/checkpoint.mjs:56-61` (`atomicWriteJson`, the canonical pattern)
- `lib/writes/sent-log.mjs` (`#persist`/`#load`, fixed in commit `b6dc4bce`) and `tests/writes/sent-log.test.mjs`
- `lib/embed/approval-queue.mjs` (`#persist`/`#loadFromDisk`/`enqueue`, fixed in commit `deba1a90`) and `tests/embed-approval-queue-concurrency.test.mjs`
