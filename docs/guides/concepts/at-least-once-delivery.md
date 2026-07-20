# At-least-once tick and queue delivery

Construct's standing-assignment and intake pipelines assume **at-least-once** delivery: a trigger, queue item, or tick may arrive more than once, and a worker may crash or lose its lease before finishing. Correctness comes from **idempotent handlers** plus **lease-backed claim reconciliation**, not from assuming exactly-once transport.

This page documents the delivery contract the Postgres queue provider (`lib/queue/pg-queue.mjs`) and the git-backed approval queue (`lib/embed/approval-queue.mjs`) enforce today, and what assignment authors must guarantee in their own processing logic.

## Failure modes the machinery covers

| Scenario | What happens | Safe handler contract |
|---|---|---|
| Duplicate trigger | Scheduler or daemon fires the same logical work twice | Enqueue with a stable item id, or dedupe on a fingerprint before side effects |
| Duplicate queue delivery | A claimed item is processed again after reclaim or retry | `markProcessed(id, { executionKey })` with the same key is a no-op |
| Worker crash mid-claim | Lease expires with no heartbeat | Item returns to the claim pool; attempt increments; max attempts dead-letter |
| Expired lease | Heartbeats stop (sleep/wake, hung process) | Another worker may reclaim once the lease passes |
| Daemon restart | In-memory worker state is lost | Durable queue rows survive; unheartbeated leases become reclaimable |
| Parallel claimers | Two workers call `claim()` at once | `FOR UPDATE SKIP LOCKED` grants each distinct pending item at most once |

Construct does **not** guarantee exactly-once side effects. External writes must use idempotent persistence (temp-file-then-rename), dedup reload before enqueue, or lease reconciliation patterns checked by Oracle Layer 1 invariant `external-write-has-idempotency-and-reconciliation`.

## Postgres intake queue semantics

`PostgresIntakeQueue` is the team/enterprise default `kind:"queue"` provider.

**Claim.** `claim({ claimedBy, leaseSeconds })` selects one pending row, or one previously claimed row whose lease has expired and whose attempt count is below `max_attempts`. Live leases block reclaim.

**Heartbeat.** `heartbeat(id, { workerId, leaseSeconds })` extends a live claim. Heartbeats on cancelled items return `{ renewed: false, cancelled: true }` so workers stop before repeating superseded work.

**Completion.** `markProcessed(id, { processedBy, executionKey })` is idempotent when the same `executionKey` is supplied again. A different key on an already processed row is rejected.

**Failure.** `fail(id, { workerId, reason })` reopens the item with backoff until `max_attempts`, then dead-letters.

**Cancellation.** `requestCancellation(id, { requestedBy, reason })` sets a flag visible at the next heartbeat boundary.

See `tests/pg-queue-reliability.test.mjs`, `tests/functional/pg-queue.functional.test.mjs`, and `tests/functional/at-least-once-delivery.functional.test.mjs` for the acceptance suite tied to bead `construct-4uxq0.11.5`.

## Git-backed approval queue (local / degraded mode)

When Postgres is unavailable, the embed approval queue persists to disk with the same idempotency expectations: reload-before-dedup on enqueue, temp-file-then-rename persistence, and lease acquire/heartbeat/release/reclaim for concurrent writers. Oracle invariant checks keep those patterns from regressing silently.

## Authoring rules for assignment handlers

1. **Pure or upsert side effects.** Handlers must tolerate a second run after reclaim. Append-only writes without dedup keys are unsafe under at-least-once delivery.
2. **Advance cursors after durable evidence.** Source-watch and evidence-cursor consumers must not advance a watermark at detection time; advance only after the downstream artifact is recorded (see `construct-4uxq0.11.1`).
3. **Carry an execution key through completion.** Queue consumers should pass a stable `executionKey` derived from the trigger fingerprint, bead id, or intake id into `markProcessed`.
4. **Heartbeat long work.** Renew the lease for work that may exceed `CONSTRUCT_QUEUE_LEASE_SECONDS` (default 120s), including across laptop sleep if the process resumes quickly enough.

## Related references

- [Architecture — Postgres queue provider](./architecture.mdx)
- [Flow authoring — idempotent re-entry](./flow-authoring.md)
- ADR-0093 (shared workspace server auth and lease reclaim)
- Beads: `construct-4uxq0.11.5` (this acceptance suite), `construct-4uxq0.11.1` (cursor advance after processing)
