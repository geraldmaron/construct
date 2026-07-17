# ADR-0096: Approval/drain lifecycle, resolved — adopt the lease-guarded batch drain

- **Date**: 2026-07-16
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: ADR-0094 (`docs/decisions/adr/0094-approval-drain-lifecycle.md`, ADR-N) — that document explicitly declined to choose a drain model, deferring to "a new revision or superseding ADR" once ADR-D landed with a concrete lease mechanism. This is that document.
- **Resolves**: `construct-4uxq0.4.14` (ADR-N) — the actual production-drain-model choice ADR-0094 could not make at draft time.

## Problem

ADR-0094 confirmed two facts and declined to decide between them: manual single-record approval (`construct approvals approve <id>`) is the only production drain today, and the automated batch drain (`drainApprovedWriteIntents`) is implemented, tested, and called by nothing — wiring it in without a durable execution lease would manufacture the exact duplicate-external-mutation defect this audit exists to prevent. ADR-0094's own Decision section named the missing input precisely: *"That call depends on specifics ADR-D has not yet published — e.g., whether the lease is per-record or per-queue, its TTL relative to adapter write latency, and how it interacts with the existing sent-log dedup... none of which can be assumed here without fabricating ADR-D's content."*

## Context

`docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md` (ADR-D) is now accepted. Its Decision, point 2, answers ADR-0094's open question directly and specifically for this exact code path — not just in the abstract:

> "For `drainApprovedWriteIntents`, this means replacing (or wrapping) the in-memory `executedApprovalIds` Set (`lib/writes/control-plane.mjs:123`) with a lease recorded in durable storage — reusing the `ApprovalQueue`'s own persisted state (it already models `'awaiting_approval'` / `'approved'` / `'denied'` / `'expired'`... is the natural extension, adding an `'executing'`-with-lease-expiry state rather than inventing a second store."

This is per-record (not per-queue), lives on `ApprovalQueue` itself rather than a separate lease store, and ADR-D's point 3 additionally settles the sent-log interaction ADR-0094 flagged as unknown: idempotency keys (`WriteSentLog`, already fixed this session for atomicity — `construct-4uxq0.9.1`) remain the independent second guard against sequential re-delivery after a lease legitimately expires; the lease guards against concurrent double-execution, the sent-log guards against sequential re-execution. Both are required per ADR-D; neither is optional. The one input ADR-D leaves to implementation, not this ADR, is the lease TTL relative to adapter write latency (ADR-D point 4: "the implementing bead should still audit whether the initial lease window... is long enough").

## Decision

1. **Adopt `drainApprovedWriteIntents` as the production batch drain**, superseding manual single-record `construct approvals approve <id>` as the primary operator path. Manual single-record approval is not removed — an operator can still act on one record directly — but the automated batch drain becomes the mechanism a daemon job or scheduled task is authorized to call.
2. **This is gated on `construct-4uxq0.9.3` landing the `ApprovalQueue` `'executing'`-with-lease-expiry state ADR-D specifies.** Wiring `drainApprovedWriteIntents` into any production caller before that state exists remains prohibited, exactly as ADR-0094 held — this ADR changes *what* gets built (a concrete target: extend `ApprovalQueue`, not a new lease store) and *that* it should be wired once built, not the sequencing itself.
3. **`construct-4uxq0.9.5` (408b, write-intent-drain wiring) is unblocked to proceed once `.9.3` lands**, with an explicit implementation contract: `drainApprovedWriteIntents` must acquire the `ApprovalQueue` lease for each `approved` record before calling `executeApprovedWriteIntent`, release (or let expire) the lease on completion or failure, and continue relying on `WriteSentLog` idempotency as the second guard — not a replacement for the lease.

## Rationale

ADR-0094's refusal to decide was correct at the time — recommending a drain model before ADR-D existed would have required inventing the lease mechanism to justify the recommendation, which is the fabrication ADR-0094 explicitly named and declined to commit. Now that ADR-D specifies the mechanism concretely and for this exact call site (not a generic "leases exist somewhere" hand-wave), the second half of ADR-0094's own stated question — "keep manual approval as the sole path, or run both under a shared lease" — resolves in favor of adopting the batch drain: the tested code already exists (`tests/writes/control-plane-execution.functional.test.mjs`), the operator-facing gap ADR-0094 named (no bulk-approval path) is real and unaddressed by keeping manual-only, and ADR-D's chosen mechanism (extend `ApprovalQueue` rather than a new store) is additive to code that already exists rather than requiring new infrastructure beyond the lease state itself.

## Rejected alternatives

- **Keep manual single-record approval as the permanent, sole production path, closing the automation question rather than resolving it.** Rejected: ADR-0094 already rejected this for discarding real, tested, evidenced motivation (`drainApprovedWriteIntents` and its test suite) with no new reason to keep rejecting it now that the blocking input (ADR-D's lease design) exists.
- **Run both manual and batch drain concurrently with no distinguished "primary" path.** Rejected: ADR-D's lease is per-record, so both paths correctly race for the same lease and cannot double-execute — but leaving no primary path invites operational confusion (which one does an on-call operator use during an incident?) for no correctness benefit the lease doesn't already provide. Manual approval survives as an explicit fallback, not a co-equal default.
- **Design a new, dedicated lease store for the drain instead of extending `ApprovalQueue`.** Rejected: this is ADR-D's call, not this ADR's — ADR-D already decided against a second store ("rather than inventing a second store"), and re-opening that choice here would be redundant with, and could contradict, the accepted ADR-D.

## Consequences

- Positive: `construct-4uxq0.9.5` (408b) has an unblocked, concrete implementation contract instead of an indefinite hold; the operator-facing bulk-approval gap ADR-0094 flagged as unaddressed now has a resolution path; `drainApprovedWriteIntents`'s existing test investment is put to use rather than left permanently dead.
- Negative / cost: `.9.5` still cannot start until `.9.3` (the `ApprovalQueue` lease extension) actually lands — this ADR does not shorten that dependency, it only removes the *decision* uncertainty that sat in front of it.
- Follow-up: `.9.3`'s implementation should specifically extend `ApprovalQueue`'s state machine with the `'executing'` state per ADR-D point 2, not invent an alternate mechanism; `.9.5` should wire `drainApprovedWriteIntents` against that state per this ADR's point 3 once it exists.

## Reversibility

High: adopting `drainApprovedWriteIntents` as primary while keeping manual approval as a fallback is a routing/preference decision, not a data-format or schema change — reverting to manual-only after this lands is a config/wiring change, not a migration.

## References

- `docs/decisions/adr/0094-approval-drain-lifecycle.md` (ADR-N, superseded by this document)
- `docs/decisions/adr/0089-delivery-semantics-leases-idempotency.md` (ADR-D, the accepted decision this ADR builds on — Decision points 2 and 3 specifically)
- `lib/writes/control-plane.mjs:122` (`drainApprovedWriteIntents`), `lib/cli/approvals.mjs:32` (`runApprovalsCli`, manual path)
- `lib/embed/approval-queue.mjs` (`ApprovalQueue` — the state machine `.9.3` extends per ADR-D)
- `construct-4uxq0.9.3` (execution leases, the landing dependency), `construct-4uxq0.9.5` (408b, unblocked by this ADR once `.9.3` lands)
