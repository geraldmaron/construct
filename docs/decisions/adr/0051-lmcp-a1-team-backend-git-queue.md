<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0051: Team backend is git-queue (not Postgres) — LMCP-A1

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0020 (local orchestration runtime), ADR-0021 (provider worker backend), ADR-0046 (modular org runtime merge)
- **Tracking**: LMCP-A1

## Problem

The team/enterprise queue declaration is contradictory. Documentation declares Postgres as the queue backend for team and enterprise deployment modes, but the runtime silently routes all queue operations through the git-queue implementation instead:

- `lib/storage/backend.mjs:9-14` — `createSqlClient()` returns `null` by design; no Postgres client is ever constructed
- `lib/intake/queue.mjs:48-52` — resolves `team` and `enterprise` modes to `'git'` at runtime
- `lib/intake/queue.mjs:70-75` — aliases `'postgres'` to `'git'` so callers requesting Postgres silently get git-queue
- `lib/orchestration/run-store-postgres.mjs` — a complete-shaped Postgres store implementation exists but is unreachable through any current dispatch path
- `lib/deployment-mode.mjs` — declares `queue: 'postgres'` for team and enterprise, contradicting the runtime aliases above

The practical consequence is a latent **double-claim hazard**: two agents can concurrently claim the same work item because the documented correctness guarantee (Postgres row-level locking) is never engaged, and the actual backend (git-queue) provides only best-effort distributed claims with push-failure swallowing:

- `lib/intake/git-queue.mjs:115` — push failure caught and discarded (claim proceeds anyway)
- `lib/intake/git-queue.mjs:141-152` — push failure in `complete()` similarly swallowed

The mismatch between declaration and runtime is a class of fabrication-adjacent hazard: operators reading the docs build a mental model of Postgres-backed ACID claims, but the system never delivers it.

## Decision

**Option B — formally designate git-queue as the team backend.**

The Postgres path is not adopted at this time. The git-queue implementation already carries all solo and team traffic; it is operationally proven and imposes no external service dependency on operators.

Specifically:

1. **Update all deployment-mode declarations** — change `queue: 'postgres'` to `queue: 'git'` for team and enterprise in `lib/deployment-mode.mjs`. Remove the `'postgres'` → `'git'` alias from `lib/intake/queue.mjs` (it becomes unnecessary and misleading).

2. **Fix claim() push-failure swallowing** — `lib/intake/git-queue.mjs` claim and complete paths must propagate push failures rather than silently succeeding. A failed push means the claim or completion is not durable; callers must see the error and retry or surface it.

3. **Document the correctness envelope** — the git-queue provides a single-writer guarantee only when backed by dolt's underlying storage (dolt's row-level locking prevents concurrent writes to the same branch). Distributed multi-agent claim correctness is best-effort: a second agent may read a stale queue state before the first agent's push is visible. This limitation is to be documented explicitly in `docs/guides/concepts/queue-backends.md` and in the queue module's JSDoc.

4. **Gate Postgres behind a future provider-plugin path** — `lib/orchestration/run-store-postgres.mjs` is retained as-is. Postgres is available as a future queue-backend plugin (see ADR-0052's provider manifest `kind: 'queue'`); no operator can activate it until that plugin path is complete and migrations are shipped. The implementation file must carry a `@unreachable` JSDoc tag until then.

5. **File LMCP-G beads** for lease/retry improvements on top of git-queue: optimistic locking via claim-token comparison, exponential backoff on push failure, and a lease-expiry mechanism so crashed agents release claimed items.

## Alternatives considered

- **Option A — implement Postgres fully**: adopt `run-store-postgres.mjs`, add a migration runner, document the `DATABASE_URL` env requirement. Provides ACID claim correctness. Rejected because no customer need for full Postgres ops burden is validated yet; it adds a mandatory external service dependency for team users who currently need none; and the correctness gap in git-queue can be narrowed significantly by fixing push-failure propagation and adding the lease model (LMCP-G).

- **Option C — make git-queue ACID by introducing a local lock file**: a file-system advisory lock prevents concurrent claims on the same machine. Rejected because it does not help multi-machine distributed agents, and dolt's storage already provides single-machine serialization; the real problem is multi-agent distributed concurrency that needs the lease model (LMCP-G), not a local lock.

## Consequences

- `lib/deployment-mode.mjs` team/enterprise `queue` field changes from `'postgres'` to `'git'`; the alias in `lib/intake/queue.mjs` is removed.
- `lib/intake/git-queue.mjs` claim and complete paths throw (or return a typed error) on push failure instead of swallowing it; callers that currently rely on silent success must be updated.
- `lib/orchestration/run-store-postgres.mjs` is tagged `@unreachable` and remains in-tree as a scaffold for the future plugin path.
- Operators reading documentation will see an accurate description of the git-queue backend with its correctness envelope and known limitations.
- LMCP-G1..G10 (lease/retry/backoff improvements), LMCP-O2 (queue observability), and LMCP-O4 (claim-state reconciliation) are unblocked by this decision.
