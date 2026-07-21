<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0093: Shared workspace server — membership-resolved bearer tokens over an additive HTTP deployment mode

- **Date**: 2026-07-18
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: extends `docs/decisions/adr/0001-zero-npm-core.md` (the `node:http`, no-framework constraint this server obeys); reuses `docs/decisions/adr/0021-provider-worker-backend-and-pluggable-run-stores.md`'s Postgres worker-claim primitives without modifying them; builds on `docs/decisions/adr/0092-single-project-identity-derivation.md` (the one `deriveProjectKey` id this server stores against, never mints); `lib/server/`, `lib/workspace/postgres-store.mjs`, `lib/db/migrations/008_workspace_foundation.sql`, `lib/db/migrations/009_server_tokens.sql`, `docs/notes/research/workspace-control-plane/synthesis/shared-server-design.md`, bead `construct-b0nny.26`

<!-- Owning specialist: cx-architect. -->

## Problem

Directive §17's E7 outcome asks for a shared workspace server — auth, Postgres, shared artifacts, worker claims, concurrent users, recovery, deployment image — as the "team/enterprise mode" deployment surface. The directive's own §18/§19 "one product model across embedded and shared deployment" standard, restated as bead `construct-b0nny.26`'s binding Non-goals, requires this to be strictly additive: the local-first solo product must keep working unchanged.

Two properties made the shape non-obvious. First, `construct-b0nny.26`'s File-ownership note warned "some of this may already partially exist — audit before assuming a blank slate." An audit found that `construct-b0nny.19`'s queue-provider and worker-registry migrations already ship a Postgres-backed, lease-based, `SELECT ... FOR UPDATE SKIP LOCKED` claim primitive (`lib/queue/pg-queue.mjs`, `lib/orchestration/worker-runtime.mjs`) with a live "parallel claimers produce zero double-claims" test — so requirements 3 (worker-claim semantics) and 4 (crash recovery) were already implemented at the library level, not net-new. Second, nothing anywhere decided *who* may reach those primitives for *which* Workspace: there was no multi-user authorization surface in the product at all, and `lib/workspace/store.mjs` was deliberately SQLite-only (its own constraint 6 deferred the Postgres/shared backend to E7).

## Decision

Build a thin, authenticated `node:http` façade (`lib/server/http.mjs`) over three domain primitives — a new `PostgresWorkspaceStore` (workspace/membership rows), and the *unmodified* existing `PostgresIntakeQueue` and `WorkerRegistry` — reachable only via an explicit `construct server start` invocation with a reachable Postgres `DATABASE_URL`. No solo-mode code path imports it.

Authorization is membership-resolved bearer tokens, not a parallel auth system:

- The unit of authorization is a row in `construct_workspace_members` (`workspace_id`, `member_ref`, `role ∈ {owner, member}`) — the exact table and role vocabulary E2 already shipped, carried verbatim into the new Postgres store. No second membership concept, no richer permission model (per-action authorization rules remain E6/Policy territory).
- A server token is a credential that *resolves to* one membership row and grants no authority beyond that row's `role`. Only the sha256 hash is persisted (`construct_server_tokens.token_hash`); the raw token is returned once at mint time and never stored. Verification re-joins the live membership table on every request, so `removeMember` takes effect on the very next request even if the token is otherwise unexpired.
- Bootstrap uses a two-tier split: `CONSTRUCT_SERVER_ADMIN_TOKEN` (operator secret, env-only, never in the DB) authorizes exactly one action — `POST /workspaces` (create + add caller as first `owner` + mint the owner's token). If it is unset, that one route is permanently disabled (501), never silently open. Every other route requires a member token; owners admit further members via `POST /workspaces/:id/members`.
- Path-level isolation: a token for Workspace A can never reach Workspace B's data — the route's `:id` is checked against the token's resolved `workspace_id` (403 on mismatch), and owner-only routes reject member-role tokens (403).

This mirrors the request-pipeline shape `lib/mcp/transport/http.mjs` already established (a pure, unit-testable header→decision function, `WWW-Authenticate` challenge on 401, loopback-by-default binding, TLS expected at a reverse proxy). Deployment ships as `Dockerfile.server` (one process, non-root) plus `docker-compose.yml` (Postgres + one-shot `migrate` + server).

## Rationale

The lease-based claim primitive already validated under real concurrent load (spike E, `construct-b0nny.19`) is the correct recovery mechanism; re-deriving a new concurrency primitive would risk exactly the class of bug spike E's harness exists to catch. So the server adds no new recovery logic — it exposes the existing `(status = 'claimed' AND lease_expires_at <= now() AND attempt < max_attempts)` reclaim predicate over HTTP and proves it at the server boundary with the same discipline (a real `SIGKILL` to a real worker process, not a caught exception).

Tying auth to `construct_workspace_members` rather than inventing a parallel system directly satisfies the bead's Authority-requirements line ("route through the same authority model M2 formalizes, not a parallel one") and keeps the "one product model" contract at the domain-shape level: the same `deriveProjectKey(rootDir)` id, the same `rowToWorkspace` field shape, and the same forward-only `provisioning → active → archived` lifecycle apply whether a Workspace's row lives in a solo `workspace.db` or the shared server.

## Rejected alternatives

- **A richer per-action permission model now.** Rejected: `workspace-domain-design.md` §3.2 already ruled membership *records* who belongs while Policy *governs* what an effect may do; a two-role coarse gate matches the schema E2 shipped, and per-action rules are E6's job. Building them here would pre-empt an undesigned outcome.
- **Reinvent the worker-claim/recovery primitives inside the server.** Rejected: `construct-b0nny.19`'s `pg-queue.mjs` already implements contention-safe claims and lease-expiry recovery with a live proof; a second implementation would duplicate surface and re-open a solved concurrency-correctness risk.
- **SSO/OIDC/password auth, token rotation, rate limiting.** Deferred, not built: the bead's instruction is "design first, build the smallest correct thing that ties into E2's membership fields." These are named explicitly as production-hardening follow-ups in the design doc's Limitations section rather than silently assumed sufficient for an internet-facing deployment.
- **A framework (Express/Fastify).** Rejected under ADR-0001's zero-npm-core constraint; `node:http` with a small route table matches `lib/mcp/transport/http.mjs`'s and `lib/org-studio/server.mjs`'s existing precedent.

## Consequences

- A new, optional deployment mode exists. A solo user who never sets `DATABASE_URL` and never runs `construct server` sees zero behavior change; every existing solo-mode test is unaffected.
- Two new Postgres migrations (`008`, `009`) land on the existing `lib/db/migrate.mjs` ledger — no new runner, no new ledger table.
- The concurrent-user and recovery acceptance tests require a real Postgres; with none reachable they skip with a named reason (`CONSTRUCT_REQUIRE_POSTGRES_TEST=1` forces failure), following the `pg-queue.functional.test.mjs` / `relational-postgres-store.test.mjs` convention — never a fabricated pass.
- No client-side transport-switch library ships in this bead; only the server and the identical domain shapes that make building one later a thin transport choice.

## Reversibility

Two-way door. The server is purely additive: deleting `lib/server/`, the `server` CLI handler, and migrations `008`/`009` leaves solo mode exactly as it was, which is the bead's own stated rollback target if E7 proves unready. Promoting shared mode to a required or default surface would need a superseding ADR.

## References

- [ADR-0001: Zero npm dependencies in core](0001-zero-npm-core.md)
- [ADR-0021: Provider worker backend and pluggable run stores](0021-provider-worker-backend-and-pluggable-run-stores.md)
- [ADR-0092: Single project-identity derivation](0092-single-project-identity-derivation.md)
- `docs/notes/research/workspace-control-plane/synthesis/shared-server-design.md`
- `docs/notes/research/workspace-control-plane/synthesis/spike-e-recovery.md`
- `lib/server/http.mjs`, `lib/server/auth.mjs`, `lib/server/cli.mjs`, `lib/workspace/postgres-store.mjs`
- `lib/db/migrations/008_workspace_foundation.sql`, `lib/db/migrations/009_server_tokens.sql`
- `Dockerfile.server`, `docker-compose.yml`
