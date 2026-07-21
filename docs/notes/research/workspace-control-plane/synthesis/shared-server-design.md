---
intake: none
---

# Shared Workspace Server — Design (`construct-b0nny.26`, E7)

Authored 2026-07-18 for bead `construct-b0nny.26`, epic `construct-b0nny`. Single strong lead,
no fan-out, per the bead's own locked decision ("First deliverable is a design pass... before
any server code is written, mirroring the target-model.md/graph-store-design.md precedent").
Written and reviewed before server implementation, per `workspace-domain-design.md`'s own
precedent for this program.

Inputs read in full before designing anything: `bd show construct-b0nny.26` (requirements,
locked non-goals, acceptance criteria), `docs/notes/research/workspace-control-plane/synthesis/
spike-e-recovery.md` (the recovery proof pattern this bead must reuse, not re-derive),
`docs/notes/research/workspace-control-plane/synthesis/workspace-domain-design.md` (E2's
Workspace domain model — the domain this server serves over a network boundary),
`docs/notes/research/workspace-control-plane/synthesis/target-model.md` concepts 1 (Workspace)
and 9 (Assignment), `docs/notes/research/workspace-control-plane/synthesis/disposition-matrix.md`
(C2/D5 run-store rebuild precedent), `lib/workspace/` (store.mjs, sqlite-db.mjs, migrations),
`lib/graph/relational/postgres-store.mjs` (the Postgres adapter shape bead .21 proved live),
`lib/queue/pg-queue.mjs`, `lib/orchestration/worker-runtime.mjs`, `lib/db/migrate.mjs`,
`lib/db/migrations/00{2,3,7}_*.sql`, `lib/mcp/transport/http.mjs` (the repo's one existing
authenticated `node:http` server, whose auth-pipeline shape this design mirrors), and
`lib/storage/backend.mjs` (`createSqlClient`, the one Postgres-connection factory every backend
in this repo already shares).

## 0. The load-bearing discovery: most of requirements 2–4 already exist

Per the bead's own File ownership note — "some of this may already partially exist — audit
before assuming a blank slate" — a full audit before writing any server code found that
`construct-b0nny.19`'s "queue provider" and "worker registry" migrations
(`lib/db/migrations/002_queue_provider.sql`, `003_worker_registry.sql`) already ship a
Postgres-backed, lease-based, contention-safe claim primitive:

- **`lib/queue/pg-queue.mjs`'s `PostgresIntakeQueue`** — `claim()` uses a single
  `SELECT ... FOR UPDATE SKIP LOCKED` CTE feeding an `UPDATE`, so parallel claimers contend
  inside Postgres, not in process memory (no double-claim is possible by construction, not by
  application-level locking). `heartbeat()` renews a lease; an un-renewed lease
  (`lease_expires_at <= now()`) becomes reclaimable by another caller automatically —
  requirement 3 ("a worker claims a piece of work, another worker must not duplicate it") and
  requirement 4 ("recovery story for a worker that crashes mid-claim") are *already
  implemented*, not net-new surface this bead needs to invent.
- **`tests/functional/pg-queue.functional.test.mjs`** already has a live (DATABASE_URL-gated)
  "parallel claimers produce zero double-claims" test and an "expired lease makes an item
  reclaimable exactly once" test — i.e., requirement 2's concurrent-load proof and requirement
  4's recovery proof already exist *at the library level*, following the exact
  `createSqlClient(env)`-null-skip idiom `tests/graph/relational-postgres-store.test.mjs`
  established.
- **`lib/orchestration/worker-runtime.mjs`'s `WorkerRegistry`** — worker identity, heartbeat,
  and staleness detection (`heartbeat_at + lease_ttl_seconds < now()`) over
  `construct_workers`, already Postgres-backed.

This changes the bead's real scope. What is **not** built anywhere yet, and is this bead's
actual job:

1. **A network-facing server** that lets physically separate clients (multiple users, multiple
   worker processes) reach these primitives over HTTP — today they are only importable Node
   modules, not a running service. Directive §18's "one product model across embedded and
   shared deployment" and this bead's own Non-goals both require this to be additive on top of
   the existing local-first CLI, not a replacement for it.
2. **Auth** — nothing today decides *who* may call these primitives for *which* Workspace. This
   is entirely new and is this design's largest section (§2).
3. **A Postgres-backed Workspace store** — `lib/workspace/store.mjs` is SQLite-only by its own
   explicit design (constraint 6: "Postgres/shared backend is deferred to E7"). The shared
   server needs a durable, multi-client-reachable home for Workspace/membership rows; SQLite's
   one-file-per-project-on-one-machine model does not fit a remote server multiple machines
   connect to.
4. **Proof at the server boundary, not just the library boundary.** The existing pg-queue tests
   prove the Postgres primitive is correct; this bead's acceptance criteria ask for the proof
   through the actual deployed surface (HTTP claims, a really-killed worker process), reusing
   the same primitive and the same spike-E discipline ("a real SIGKILL... cannot be intercepted,
   so nothing in the process gets a chance to clean up") rather than re-deriving new concurrency
   primitives from scratch.
5. **Deployment image + Docker Compose.**

Reuse, not reinvention, follows directly: the server is a thin, authenticated HTTP façade over
`PostgresWorkspaceStore` (new, §3), `PostgresIntakeQueue` (existing, unmodified), and
`WorkerRegistry` (existing, unmodified).

## 1. Non-goals (restated from the bead, binding)

- Does not change solo-mode / embedded deployment. `lib/workspace/store.mjs` (SQLite),
  `lib/graph/relational/sqlite-*.mjs`, and every existing CLI command are untouched. A solo user
  who never sets `DATABASE_URL` and never runs `construct server` sees zero behavior change.
- Does not build Policy/authorization *rules* (concept 13, E6) — per workspace-domain-design.md
  §3.2's own ruling, Workspace membership *records* who belongs; Policy *governs* what an
  effect may do. This design's auth model answers "is this caller a member of this Workspace,
  and are they an owner or a member" — coarse, two-role, matching the schema E2 already shipped
  (`construct_workspace_members.role CHECK IN ('owner','member')`). It does not invent a richer
  permission model; E6 is where per-action authorization rules eventually live.
- Does not redesign `lib/graph/relational/` or wire a Postgres backend switch into the graph
  CLI — bead `.21`'s own closing disclosure already named that as a separate, larger change
  outside this program's remaining scope.
- Does not build container-worker spawning (`lib/orchestration/run-store-postgres.mjs`'s header
  already scopes that out under ADR-0021); "worker" here means a client process that calls
  claim/heartbeat/complete, exactly the same contract `pg-queue.mjs` already exposes to
  in-process callers.

## 2. Auth model

### 2.1 Ties to E2 membership, not a parallel system (bead requirement, binding)

The bead's own Authority requirements line is explicit: "Auth/membership decisions should route
through the same authority model M2 formalizes, not a parallel one." Concretely:

- The unit of authorization is a **row in `construct_workspace_members`** (`workspace_id`,
  `member_ref`, `role`) — the exact table E2 already shipped, carried over verbatim into the new
  Postgres-backed store (§3). No second membership concept, no new role vocabulary: still
  exactly `owner` | `member`.
- A server-issued **token** is a credential that *resolves to* one membership row — it grants
  no authority of its own beyond what that row already records. Revoking membership
  (`removeMember`) and revoking a token are two different operations (a member can hold a fresh
  token after a laptop-loss revoke without losing their `role`), but a request is authorized only
  when *both* a live token *and* a live membership row resolve to the same
  `(workspace_id, member_ref)` pair — checked on every request, not cached, so a `removeMember`
  call takes effect on the very next request even if the caller's token is still technically
  unexpired.
- Provider-write/destructive-effect authorization (M2's authority ledger,
  `lib/writes/authority-ledger.mjs`) is a different chokepoint for a different concern (external
  effects leaving Construct's boundary) and is untouched — this design's auth gate is entirely
  about "may this HTTP request reach this Workspace's data at all," upstream of and orthogonal
  to M2's ledger.

### 2.2 Bootstrap: who can join a Workspace

A Workspace has to acquire its first member before any member-authorized endpoint can be
called — a pure membership-based bootstrap is circular. Two credential tiers, mirroring the
"operator secret vs. per-user credential" split every shared-deployment system needs:

- **`CONSTRUCT_SERVER_ADMIN_TOKEN`** (operator secret, env-configured on the server process,
  never stored in the database) — authorizes exactly one action: `POST /workspaces` (create a
  Workspace on the server and add the caller as its first `owner` member, minting that owner's
  first member token in the same response). This mirrors `lib/mcp/transport/http.mjs`'s own
  fail-closed posture (`resolveHttpAuthConfig` throws before `listen()` on missing config) — if
  `CONSTRUCT_SERVER_ADMIN_TOKEN` is unset, `POST /workspaces` is permanently disabled (501), not
  silently open.
- **Member tokens** — every other endpoint. An `owner` can call
  `POST /workspaces/:id/members` to add a new member and mint *their* token (returned once, in
  the response body only, never persisted in plaintext — see §2.3). This is the "who can join"
  answer: workspace owners admit members, exactly the authority `construct_workspace_members`
  already models, and the admin token never grants day-to-day workspace access, only the one
  bootstrap action.

### 2.3 Token storage and verification

New table, `construct_server_tokens` (migration §4.2): `token_hash` (sha256 of the raw token,
never the raw token itself — the same "never store the credential, only its verifier" discipline
`lib/providers/secret-resolver.mjs` and every credential path in this repo already follow),
`workspace_id`, `member_ref`, `created_at`, `revoked_at`. The raw token
(`crypto.randomBytes(32).toString('base64url')`, matching `pg-queue.mjs`'s existing
`newQueueId`-style use of `node:crypto`) is returned to the caller exactly once, at mint time;
the server never has it again. Verification: hash the inbound bearer token, look up
`(token_hash) → (workspace_id, member_ref)`, reject if `revoked_at IS NOT NULL`, then join against
`construct_workspace_members` for the live `role` — a request whose membership row was deleted
after the token was minted fails at the join, per §2.1.

### 2.4 Request pipeline (mirrors `lib/mcp/transport/http.mjs`'s shape exactly)

That file is the one existing precedent in this repo for an authenticated `node:http` server; it
already established the pattern this design reuses rather than inventing a second shape:
a pure, unit-testable decision function (headers + config → decision or thrown typed error) that
`http.createServer`'s callback calls before touching any handler, plus a `WWW-Authenticate`
challenge on 401 and localhost-by-default binding.

```
authorizeRequest(headers, { sql }) -> { workspaceId, memberRef, role } | throws AuthError
```

1. Missing/malformed `Authorization: Bearer <token>` → 401, `WWW-Authenticate: Bearer
   realm="construct-server"`.
2. Token not found / revoked → 401 (same message as #1 — do not distinguish "bad token" from
   "revoked token" in the response, an information-leak-avoidance discipline this repo already
   applies at `lib/mcp/transport/http.mjs`'s bearer check).
3. Token resolves but the joined membership row is gone → 401 (§2.1's "both must be live" rule).
4. Route requires `role: 'owner'` (member-add, activate, archive) and the resolved role is
   `member` → 403.
5. Route's `:workspaceId` path param does not match the token's `workspace_id` → 403 (a valid
   token for Workspace A can never reach Workspace B's data — this is the row-level isolation
   the whole design exists to guarantee).

### 2.5 What this does *not* solve (honest scope boundary)

No SSO/OIDC integration, no password auth, no token rotation policy, no rate limiting beyond
what the process naturally has. These are legitimate follow-ups for a production-hardening bead,
not inside this bead's "design first, build the smallest correct thing" instruction — the token
model above is deliberately the minimal credential shape that satisfies "ties into E2's
membership fields... not a separate auth system," and is explicitly flagged in the Limitations
section (§8) rather than silently assumed sufficient for an internet-facing deployment without a
reverse-proxy TLS terminator in front of it (same posture `lib/mcp/transport/http.mjs`'s own
header comment already documents: "TLS is expected to be terminated by a reverse proxy").

## 3. Postgres-backed Workspace store

`lib/workspace/postgres-store.mjs`, mirroring `lib/graph/relational/postgres-store.mjs`'s class
shape exactly (constructor takes `{ sql, workspace }`, `ensureSchema()` delegates to
`lib/db/migrate.mjs`'s `applyMigrations`, every method is `async`, no `node:sqlite`
dependency — the server never requires Node ≥22.5, only whatever `postgres` (the npm package)
needs). Unlike `lib/workspace/store.mjs`, which is keyed by `rootDir` and derives the id
internally (embedded mode has a filesystem to derive from), the server has no filesystem to
derive an id from — every method takes an explicit `id` (the caller already computed
`deriveProjectKey(rootDir)` locally before ever talking to the server, so the *derivation* is
still single-sourced in `lib/state-root.mjs`; the server only ever *stores against* an id a
client already derived, never mints one). This is the "one product model" contract (§7): the
same id a solo user's local `workspace.db` would use is the id a team sends to the shared
server — switching `deployment: embedded → shared` does not change what a Workspace's identity
*is*, only where its row lives.

Schema (migration §4.1) is the workspace-domain-design.md §4 DDL with the documented
`TEXT → TIMESTAMPTZ` substitution constraint 6 of that design pre-declared ("the same
TEXT→TIMESTAMPTZ type substitution graph-store-design.md documents for its own two backends —
not a schema redesign"): `construct_workspaces`, `construct_workspace_members`, unchanged
columns and CHECK vocabularies.

## 4. Migrations (Postgres, via the existing `lib/db/migrate.mjs` runner)

Two new numbered files land in `lib/db/migrations/`, continuing the existing ledger
(`construct_schema_migrations`) `lib/db/migrate.mjs` already owns — no new migration runner, no
new ledger table, following the exact precedent bead `.21`'s `007_graph_foundation.sql` set for
adding a new Postgres-backed subsystem onto the shared runner.

- **`008_workspace_foundation.sql`** — `construct_workspaces`, `construct_workspace_members`
  (§3).
- **`009_server_tokens.sql`** — `construct_server_tokens` (§2.3), FK to
  `construct_workspaces(id)`.

## 5. HTTP API surface

`lib/server/http.mjs` (`node:http`, no framework — ADR-0001 keeps npm out of core, the same
constraint `lib/org-studio/server.mjs`'s header already documents and follows). Every route
below is workspace-scoped by path (`/workspaces/:id/...`); `:id` is always checked against the
resolved token's `workspace_id` (§2.4 step 5).

| Method | Path | Auth | Delegates to |
|---|---|---|---|
| `GET` | `/healthz` | none | pure liveness, touches no DB |
| `GET` | `/readyz` | none | `probeSqlClient` (`lib/storage/backend.mjs`) |
| `POST` | `/workspaces` | admin token | `PostgresWorkspaceStore.createWorkspace` + `addMember(role:'owner')` + mint token |
| `GET` | `/workspaces/:id` | member | `PostgresWorkspaceStore.getWorkspace` |
| `POST` | `/workspaces/:id/activate` | owner | `activateWorkspace` |
| `POST` | `/workspaces/:id/archive` | owner | `archiveWorkspace` |
| `POST` | `/workspaces/:id/members` | owner | `addMember` + mint token |
| `DELETE` | `/workspaces/:id/members/:memberRef` | owner | `removeMember` + revoke that member's tokens |
| `GET` | `/workspaces/:id/members` | member | `listMembers` |
| `GET`/`PUT` | `/workspaces/:id/settings` | member / owner | `getSettings` / `setSetting` |
| `POST` | `/workspaces/:id/work` | member | `PostgresIntakeQueue.enqueue` (queue name fixed to `assignments`, scoped by workspace id as `project`) |
| `POST` | `/workspaces/:id/work/claim` | member | `PostgresIntakeQueue.claim` |
| `POST` | `/workspaces/:id/work/:itemId/heartbeat` | member | `PostgresIntakeQueue.heartbeat` |
| `POST` | `/workspaces/:id/work/:itemId/complete` | member | `PostgresIntakeQueue.markProcessed` |
| `POST` | `/workspaces/:id/work/:itemId/fail` | member | `PostgresIntakeQueue.fail` |
| `GET` | `/workspaces/:id/work/stats` | member | `PostgresIntakeQueue.queueStats` |
| `POST` | `/workspaces/:id/workers/register` | member | `WorkerRegistry.register` |
| `POST` | `/workspaces/:id/workers/:workerId/heartbeat` | member | `WorkerRegistry.heartbeat` |
| `GET` | `/workspaces/:id/workers` | member | `WorkerRegistry.list` |

`project` for the queue/worker classes is always the Workspace id — one queue namespace and one
worker namespace per Workspace, `tenantId` fixed to `'shared'` to keep this server's rows
distinguishable from any embedded-mode Postgres experimentation using the default `'local'`
tenant, per `lib/orchestration/run-store-postgres.mjs`'s existing tenant-column convention.

## 6. Recovery story (requirement 4)

Reuses spike E's proof discipline directly rather than re-deriving a new interruption-testing
approach: a *real* `SIGKILL` delivered to a *real* OS process, not a caught exception or a
narrated "assume this crashes" step (`spike-e-recovery.md` §"Why a self-inflicted SIGKILL counts
as a real crash"). Mechanism is `pg-queue.mjs`'s already-proven lease expiry (§0), exercised
through the server this time:

1. A worker process registers, claims a work item via `POST /work/claim` with a short lease
   (test-only `leaseSeconds`), and is then sent `SIGKILL` before it ever calls `/heartbeat` or
   `/complete` — the crash lands exactly where spike E's `during_execution` interruption point
   lands: after the real claim commits, before the stage (here, the whole assignment) completes.
2. No cleanup code runs (SIGKILL cannot be caught) — the claim row is left exactly as the crash
   left it: `status = 'claimed'`, `lease_expires_at` in the past once the lease window elapses.
3. A second, live worker calls `/work/claim` after the lease expires and receives the *same*
   item id, with `attempt` incremented — `pg-queue.mjs`'s existing
   `(status = 'claimed' AND lease_expires_at <= now() AND attempt < max_attempts)` claim
   predicate is the recovery mechanism; the server adds no new recovery logic, it only exposes
   this one over HTTP.
4. The functional test (§9) asserts: the killed process's exit signal really was `SIGKILL`
   (`spawnSync(...).signal === 'SIGKILL'`, the same evidence spike E's matrix checks), the item
   is reclaimed exactly once (not duplicated, not permanently stuck), and `attempt` reflects two
   real claims.

This is "resumed" in the queue-semantics sense the bead asks for (the work becomes claimable
again and a second worker picks it up) — there is no per-assignment checkpoint/resume state
machine here the way spike E's 7-stage harness had, because an Assignment (target-model.md
concept 9) has no sub-stage checkpoint model yet (that is E3/E6 territory); "released" is the
correct and only recovery outcome available at this layer, and the design does not claim more
than that.

## 7. Integration contract — "one product model" (bead's own binding requirement)

The bead's Integration contract line: "The server's public API should let the same client code
work against local (solo) or shared (server) mode transparently." Concretely, this design keeps
that contract at the *domain-shape* level, not by literally sharing one client module in this
bead (building a full client-side backend-switch abstraction is a larger, separate change,
matching bead `.21`'s own disclosed non-goal of not wiring a backend switch into the graph CLI):

- Identical field names/shapes: the HTTP JSON body for a Workspace is exactly
  `rowToWorkspace`'s shape (`lib/workspace/store.mjs`) — `id`, `name`, `rootPath`, `remote`,
  `deployment`, `state`, `owner`, `settings`, `createdAt`, `updatedAt`, `archivedAt`. A caller
  that already knows the embedded shape does not need a second mental model for the shared
  shape.
  `deployment` is always `'shared'` for a server-created Workspace (matches the design doc's
  `deployment enum(embedded, shared)` field — the server is definitionally the shared side of
  that enum).
- Identical lifecycle semantics: `STATE_TRANSITIONS` (`provisioning → active → archived`) is the
  same forward-only machine, enforced server-side with the same `WORKSPACE_INVALID_TRANSITION`
  error code `lib/workspace/store.mjs` already raises.
- Identical id derivation (§3): a project's Workspace id is `deriveProjectKey(rootDir)`
  regardless of which deployment mode stores its row.
- A future bead (not this one) can build the client-side transport switch
  (`CONSTRUCT_WORKSPACE_MODE=embedded|shared` selecting `lib/workspace/store.mjs` vs. an HTTP
  client hitting this server); this design's job is to make that switch a thin transport choice
  by keeping the shapes identical now, not to build the switch itself.

## 8. Limitations (honest, not silently assumed away)

- No SSO/OIDC/password auth (§2.5).
- No rate limiting, no per-IP throttling.
- No TLS termination in the server process itself — reverse-proxy expected, same posture
  `lib/mcp/transport/http.mjs` already documents.
- Recovery is release-and-reclaim only (§6) — no per-assignment checkpoint/resume state machine,
  because Assignment has no sub-stage model yet in this repo.
- The graph-edge idempotency gap spike E found (`during_graph_update` edge-weight inflation) is
  a `lib/graph/relational/` concern, out of scope for the queue/workspace primitives this server
  wraps; not re-tested here since this server never calls `enqueueOutboxEvent`/graph mutation
  paths.
- Concurrent-user and recovery tests both require a real Postgres instance
  (`DATABASE_URL`/`CONSTRUCT_DATABASE_URL`); in an environment with no reachable Postgres they
  skip with a named reason, following `pg-queue.functional.test.mjs`'s and
  `relational-postgres-store.test.mjs`'s existing convention — never a fabricated "passed"
  result.
- No client-side transport-switch library ships in this bead (§7's closing paragraph) — only the
  server and the shape contract that makes building one later a thin change.

## 9. Proof plan (traces directly to the bead's acceptance criteria)

- **Design doc reviewed before server implementation starts** — this document.
- **Concurrent-user test** — `tests/functional/workspace-server.functional.test.mjs`: two (or
  more) simulated workers call `POST /work/claim` concurrently against a real running server
  instance (real `node:http` listener, real child-process or same-process concurrent `fetch`
  calls) backed by real Postgres; assert the claimed-item id sets are disjoint and their union
  equals every enqueued item exactly once (mirrors `pg-queue.functional.test.mjs`'s existing
  "parallel claimers" assertion shape, now proven through the HTTP boundary instead of the
  in-process library boundary).
- **Recovery test** — same file: a worker claims via HTTP, is sent a real `SIGKILL`
  before completing, and a second worker's claim after lease expiry receives the released item
  (§6).
- **Working Docker Compose deployment** — `Dockerfile.server` + `docker-compose.yml`
  (`server` + `postgres:16-alpine`), built and started for real in this environment (Docker is
  available here), not merely authored.
- **`npm run test:unit`, `construct doctor` green** — run at the end of the build, full summed
  results reported honestly.

## 10. Build order (this bead, self-handoff — matches workspace-domain-design.md §13's
single-lead precedent)

Migrations (§4) → `PostgresWorkspaceStore` (§3) → auth (§2) → HTTP server + routes (§5) → CLI
wiring (`construct server start`) → functional test incl. concurrency + recovery (§9) → Docker
image + Compose → docs (CHANGELOG, architecture) → `construct doctor` + full suite.
