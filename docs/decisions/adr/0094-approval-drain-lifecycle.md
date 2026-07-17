# ADR-0094: Approval/drain lifecycle — manual single-record approval stays canonical until ADR-D lands leases

- **Date**: 2026-07-16
- **Status**: superseded
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves (decision only)**: `construct-4uxq0.4.14` (ADR-N) — whether the production drain path for approved write intents should stay manual single-record approval, or become an automated batch drain via `drainApprovedWriteIntents`. Does not resolve `construct-4uxq0.4.4` (ADR-D, delivery semantics/leases), which this decision is hard-gated on and which remains open.

**Superseded 2026-07-16**: ADR-D (`docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md`) landed with a concrete, per-call-site lease mechanism this document identified as the missing input. Per this document's own stated resolution plan ("revisit... as a new revision or superseding ADR, not a silent edit"), see ADR-0096 for the actual drain-model decision. This document is preserved as the accurate record of what was verifiable before ADR-D existed.

## Problem

Construct has two code paths that can turn an `approved` write-intent queue record into an executed external write, and the system has never formally decided which one is the production drain:

1. **Manual single-record approval** — `construct approvals approve <id>` (`lib/cli/approvals.mjs:32` `runApprovalsCli`, `approve` subcommand at lines 68–103) — an operator approves one record and the CLI immediately calls `executeApprovedWriteIntent` for that record only.
2. **Automated batch drain** — `drainApprovedWriteIntents` (`lib/writes/control-plane.mjs:122`) — scans the whole queue for every `approved` record and executes each one through the same `executeApprovedWriteIntent`, deduplicating within a single call via an in-memory `Set`.

Only one of these is live in production today, and the other exists as tested-but-unreachable code. Wiring the unreachable one in without first closing the concurrency gap it depends on would reproduce the exact duplicate-external-mutation failure mode the audit is tracking (truth-matrix rows 21–22).

## Context

Direct verification against current code (`main`, matching the truth matrix's `main=a2e7118e` baseline plus this branch):

- **`lib/cli/approvals.mjs:32`** — `runApprovalsCli`'s `approve` subcommand (lines 68–103) is the operator's decision point. On approval it calls `executeApprovedWriteIntent(record, { rootDir })` for that one record if its tool name resolves to a known governed provider (`parseWriteIntentToolName` + `KNOWN_PROVIDERS`). The file's own header comment (lines 7–13) states this directly: *"`approve` is the operator's decision point and the sole production drain for J6 governed write intents... the only place recommend becomes execute."* Read in full, this claim holds — nothing else in the file executes a write.
- **`lib/writes/control-plane.mjs:122`** — `drainApprovedWriteIntents(approvalQueue, opts)` lists every `approved` record (`approvalQueue.list('approved')`), skips any already in `opts.executedApprovalIds` (an in-memory `Set`, not durably persisted), and calls `executeApprovedWriteIntent` for each remaining one, collecting `{ approvalId, result, error }` outcomes. It is fully implemented and exercised by `tests/writes/control-plane-execution.functional.test.mjs`.
- **Caller grep**, run exactly as specified:
  ```
  grep -rn "drainApprovedWriteIntents" lib/ bin/ tests/ --include="*.mjs" | grep -v "function drainApprovedWriteIntents"
  ```
  Result — every hit is either the function's own JSDoc reference or a test call site, none in production code:
  ```
  lib/writes/control-plane.mjs:20: *   3. drainApprovedWriteIntents() scans the queue for state === 'approved'
  tests/writes/control-plane-execution.functional.test.mjs:23:import { executeApprovedWriteIntent, drainApprovedWriteIntents } from '../../lib/writes/control-plane.mjs';
  tests/writes/control-plane-execution.functional.test.mjs:67:    const preApprovalDrain = await drainApprovedWriteIntents(queue, {
  tests/writes/control-plane-execution.functional.test.mjs:86:    const drained = await drainApprovedWriteIntents(queue, {
  tests/writes/control-plane-execution.functional.test.mjs:96:    const secondDrain = await drainApprovedWriteIntents(queue, {
  tests/writes/control-plane-execution.functional.test.mjs:122:    const drained = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
  tests/writes/control-plane-execution.functional.test.mjs:176:    const beforeApproval = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
  tests/writes/control-plane-execution.functional.test.mjs:183:    const afterApproval = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
  ```
  This confirms truth-matrix row 21's "implemented + tested, called by nothing in `lib/`/`bin/` outside its own tests" verbatim — no production caller exists on `main` or on this branch.
- **Lease grep**, per truth-matrix row 22:
  ```
  grep -rn "acquireLease\|withLease\|executionLease" lib/ bin/ tests/ --include="*.mjs"
  ```
  Result: zero matches. There is no durable execution-lease mechanism anywhere in the tree. `drainApprovedWriteIntents`'s own dedup (`opts.executedApprovalIds ?? new Set()`) is process-local and call-scoped — it does not survive a crash, a restart, or a second concurrent drain invocation (e.g., two daemon processes, or a daemon plus a manual CLI drain, racing the same `approved` record).
- **ADR-D status**: this ADR is explicitly gated on `construct-4uxq0.4.4` (ADR-D: *"Delivery semantics: at-least-once + leases + idempotency for external writes"*), planned to land as `docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md`. As of this writing, **that file does not exist** (`ls docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md` → `No such file or directory`), and the bead `construct-4uxq0.4.4` shows `[OPEN]`, not closed/ratified. ADR-D's own bead description recommends option (1) "at-least-once + leases" over at-most-once or exactly-once-via-distributed-transaction, but a bead description is a proposal, not a ratified decision — this ADR does not treat it as settled.

## Decision

**This decision cannot be made yet.** ADR-0094 is not choosing a production drain model today; it is recording the current, verified state of both paths and stating the sequencing dependency plainly, per the bead's own framing ("Hard-gated on ADR-D (leases) landing first").

What is settled by direct code inspection, and stands independent of ADR-D:

1. **Manual single-record approval (`construct approvals approve <id>`) is confirmed as the current, and only, working production drain.** It is what runs today and what any operator or automation must use until this ADR is revisited.
2. **`drainApprovedWriteIntents` must not be wired into any production caller (daemon job, CLI batch command, scheduled task) until ADR-D/0089 is ratified with an actual durable lease mechanism**, and until this ADR is updated to reflect that mechanism's specifics. Wiring it today — with only an in-memory, call-scoped `Set` for dedup and zero durable leases anywhere in the codebase — would let two concurrent drain paths (or one drain path racing a crash-restart) execute the same `approved` record twice, which is precisely the duplicate-external-mutation failure the audit's P0 findings (truth-matrix rows 21, 22, and the related row 33 worker-lease finding) exist to prevent.
3. **`construct-4uxq0.9.5` (408b, "write-intent-drain wiring (post-lease)") stays blocked** on both ADR-D landing and this ADR being revisited with a real recommendation once ADR-D's lease model is known.

When ADR-D/0089 lands, this ADR should be revisited (as a new proposed revision or superseding ADR, not a silent edit) to make the actual call: adopt `drainApprovedWriteIntents` as the batch drain gated on whatever lease primitive ADR-D specifies, keep manual approval as the sole path, or run both under a shared lease. That call depends on specifics ADR-D has not yet published — e.g., whether the lease is per-record or per-queue, its TTL relative to adapter write latency, and how it interacts with the existing sent-log dedup (`lib/writes/sent-log.mjs`, itself flagged in truth-matrix row 19 for non-atomic persistence) — none of which can be assumed here without fabricating ADR-D's content.

## Rationale

Recommending "wire the batch drain" now would require assuming ADR-D's outcome before it exists — exactly the premature-decision failure mode the bead's gate is designed to prevent. Recommending "never wire the batch drain" would discard tested, working code (`drainApprovedWriteIntents` and its functional test suite) for no evidenced reason; the code itself is not the problem, the absence of a durable concurrency guard around it is. The only position consistent with the evidence gathered here is: state what's true now (single-record manual approval works and is the only production path; the batch drain is real but structurally unsafe to wire without a lease that does not yet exist), and defer the actual production-model choice to a revision made once ADR-D's lease model is known.

## Rejected alternatives

- **Recommend wiring `drainApprovedWriteIntents` now, with the in-memory `executedApprovalIds` Set as the interim concurrency guard.** Rejected: the Set is process-local and does not survive restart or protect against a second concurrent process; wiring on top of it manufactures the duplicate-execution risk the audit explicitly flags, not mitigates it.
- **Recommend staying on manual single-record approval permanently, close the automation question now.** Rejected: this discards real, evidenced motivation for batch draining (an operator currently has to run `approve` once per record with no bulk path) without waiting for the one piece of missing infrastructure (leases) that would make automation safe. That is a decision this ADR isn't positioned to make until ADR-D exists.
- **Assume ADR-D's bead-description recommendation ("at-least-once + leases") as if already ratified, and design the drain wiring against it here.** Rejected: a bead description is a draft proposal by the same audit process, not a ratified ADR decision; treating it as settled would be exactly the fabrication this repo's no-fabrication rule prohibits — ADR-D could still change during ratification (options, TTLs, scope).

## Consequences

- Positive: the current, safe production path (`construct approvals approve <id>`) is confirmed and stays unchanged — no behavior change from this ADR. The dead-code status of `drainApprovedWriteIntents` is documented with direct evidence (grep result above) rather than asserted from memory, closing out the "is it really called by nothing" verification the bead required.
- Negative / cost: the operator-facing bulk-approval gap stays open — there is still no way to approve/drain more than one record per CLI invocation — until ADR-D lands and this ADR is revisited. `construct-4uxq0.9.5` (408b, write-intent-drain wiring) stays explicitly blocked; no downstream work should treat that bead as unblockable pending this note.
- Follow-up: revisit this ADR (new revision or superseding ADR) once `docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md` exists and its Decision section is read — do not proceed with the drain-wiring recommendation off the bead description for ADR-D alone.

## Reversibility

High: this ADR makes no code change and commits to no drain model. It only records verified current state and states a sequencing dependency. Superseding it once ADR-D lands is the expected, planned path, not a course correction.

## References

- `lib/cli/approvals.mjs:32` (`runApprovalsCli`), lines 7–13 (header comment naming `approve` the sole production drain), lines 68–103 (`approve` subcommand)
- `lib/writes/control-plane.mjs:122` (`drainApprovedWriteIntents`), lines 69–99 (`executeApprovedWriteIntent`)
- `tests/writes/control-plane-execution.functional.test.mjs` (only current caller of `drainApprovedWriteIntents`)
- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 21–22 (`drainApprovedWriteIntents` disconnected; no execution leases exist anywhere)
- `construct-4uxq0.4.14` (ADR-N bead, this decision) — depends on `construct-4uxq0.4.4` (ADR-D bead, delivery semantics/leases), which as of this writing is `OPEN`, not ratified
- `construct-4uxq0.9.5` (408b: write-intent-drain wiring, post-lease) — blocked downstream of both this ADR and ADR-D
- `docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md` — did not exist at the time this ADR was drafted; read it before treating ADR-D's lease model as settled
