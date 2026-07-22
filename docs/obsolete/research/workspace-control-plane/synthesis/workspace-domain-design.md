---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Workspace Domain Model — Design

Authored 2026-07-18 for bead `construct-b0nny.22` (E2, epic `construct-b0nny`), the
workspace-domain design **and** build task. Single strong lead, no fan-out, per the bead's own
locked decision ("this bead's OWN instruction is single-strong-lead, no-fan-out — design the
schema first, then build it yourself"), mirroring the design-then-build sequencing that already
worked for `construct-b0nny.2` → `.3` (graph store) and `.14` (identity + run-store migration
fix). This document is written and reviewed before any implementation code, per the bead's
Implementation guidance ("Do not start building storage before the design doc is reviewed").

Inputs read in full before designing anything:
[synthesis/target-model.md](target-model.md) concepts 1–7 (Workspace, Source, Objective,
Directive, Work, Work Specification, Plan) and concept 13 (Policy, referenced for its
relationship to Workspace), `lib/state-root.mjs` (M1's canonical `deriveProjectKey`),
`lib/graph/relational/` (`sqlite-db.mjs`, `migrate-sqlite.mjs`, `sqlite-store.mjs`,
`schema-version.mjs`, `workspace.mjs`, `migrations/001_graph_foundation.sql`), and
`lib/db/migrate-sqlite.mjs` + `lib/db/migrations/sqlite/001_run_store.sql` (the M1/`.14`
versioned-migration fix for the orchestration run store — the cautionary precedent this bead
must not repeat). Every load-bearing repo claim below was re-verified in this worktree
(`bead/construct-b0nny.22`, forked from `feat/workspace-control-plane`) by reading the cited
file, not recalled from the target-model synthesis alone.

---

## 0. Grounding — target-model.md concepts 1–7

This bead builds concept 1 (Workspace) only. Concepts 2–7 are **not** built here — their stores
do not exist yet — but concept 1's schema, lifecycle, and enforcement rules are written *against*
them, so their target shape from target-model.md is restated verbatim below as the contract this
design must not contradict.

| # | Concept | Verdict (target-model.md) | Relevant to this design because |
|---|---|---|---|
| 1 | Workspace | keep | This is the concept being built. |
| 2 | Source | merge | Concept 2's schema is `Source { id, workspace string, kind, connection_ref, cursor, state, last_synced_at }` — a `sources` registry **per Workspace**. The `workspace` field is the scope FK this design's Workspace table becomes the target of. |
| 3 | Objective | keep | `Objective { id, workspace string, statement, rationale, parent?, state, met_evidence, origin }` — same per-Workspace scope convention. |
| 4 | Directive (standing) | keep | `Directive { id, workspace string, instruction, trigger, emits, procedures, state }` — same convention; also the concept whose "distinct from Policy" ruling this design's owner/membership fields must not blur (Directives *generate* work, Policy *governs* effects — Workspace owns neither). |
| 5 | Work | keep | `Work { id, workspace string, objective, title, parent?, current_spec, current_plan?, state, supersedes?, impact_result? }` — the aggregate root that will eventually be scoped by this Workspace id; not built here (E3). |
| 6 | Work Specification | keep | `WorkSpecVersion { id, workspace string, work, version, ... }` — same convention, deferred to E3. |
| 7 | Plan | keep | `PlanVersion { id, workspace string, work, spec_version, version, ... }` — same convention, deferred to E3. |
| 13 | Policy | merge | Referenced because the bead's requirement 1 explicitly asks for the Workspace-to-Policy relationship. `Policy { id, workspace string, scope, requires_approval, authority, ... }` — same per-Workspace scope convention; Policy is out of this bead's build scope (E6) but the relationship (Policy rows will carry a `workspace` FK to this table) is documented in §3.3. |

Concept 1's own text (target-model.md lines 107–171, quoted for grounding, not reproduced
verbatim beyond what is load-bearing):

> **Meaning.** The top-level scope that owns everything else: one Workspace is one governed
> context (one repo, one product, or one team's operating surface) with a single canonical
> identity, one authority boundary, and one set of durable stores. Every other concept is scoped
> to exactly one Workspace.
>
> **Distinct from.** No existing concept — today "workspace" is *implicit*, derived three
> incompatible ways (D6: `deriveProjectKey`, orchestration `projectKey`, embed `resolveRootDir`)...
>
> **Owner.** A workspace-identity subsystem (target E2 "workspace domain"), replacing
> `lib/state-root.mjs`'s `deriveProjectKey`, `lib/orchestration/store.mjs`'s `projectKey`, and
> `lib/embed/daemon`'s `resolveRootDir` (D6, ADR-0092, bead `construct-36w10`).
>
> **Lifecycle.** `provisioning → active → archived`. Archived retains data read-only; there is no
> hard-delete of an active workspace with live Work.
>
> **Enforcement.** ...Schema-level: workspace id is a non-null foreign scope on every domain
> table.
>
> **Deletion behavior.** Archiving a Workspace tombstones it and cascades read-only; a purge is a
> separate, explicit, out-of-band operation that removes all scoped stores together.

And its target schema (target-model.md lines 156–168):

```
Workspace {
  id            string   # canonical, from git-remote hash; stable
  name          string
  root_path     string   # local checkout root
  remote        string?  # canonical remote url, null for local-only
  deployment    enum(embedded, shared)
  state         enum(provisioning, active, archived)
  created_at    ts
  archived_at   ts?
}
```

A correction against the current worktree: concept 1's own "Owner" prose says this subsystem
*replaces* `deriveProjectKey`/`projectKey`/`resolveRootDir`. M1 (`construct-b0nny.14`, already
merged into `feat/workspace-control-plane`) already converged the latter two onto
`deriveProjectKey` as the single canonical derivation — so by the time this bead runs, there is
only **one** existing derivation left to reconcile with, not three. §2 below states the resulting,
narrower reconciliation requirement precisely.

The bead's own brief additionally asks for a Workspace that is "owner, membership, settings,
linked sources, lifecycle" — richer than concept 1's eight-field schema. Owner/membership/settings
are not new *concepts* (nothing here invents a 19th target-model concept); they are fields on the
existing Workspace concept, justified in §3.2, and the bead's own Security note names the reason:
"Workspace membership/ownership fields are the seed of any future multi-user authorization (E7)
— design with that in mind even though E7 builds the actual auth." "Linked sources" is not a new
field — per concept 2's schema, a Source carries the FK (`workspace` field on the `sources` row),
so linkage is the *inverse* of a relationship this table anchors, not a field this table stores
(§3.3).

## 1. What already exists (re-verified, not assumed)

- **`lib/state-root.mjs`'s `deriveProjectKey(projectRoot)`** — sha256 of the normalized git origin
  remote (or a canonical-path hash with no remote), truncated to 24 hex chars. Per its own header
  comment this is "the one authoritative 'which project is this' derivation" post-M1;
  `lib/orchestration/store.mjs`'s `projectKey` and `lib/embed/daemon.mjs`'s `resolveProjectKey`
  both already delegate to it (confirmed by `tests/functional/run-store-identity-convergence.functional.test.mjs`,
  which asserts all three agree). There is no fourth derivation left to converge.
- **`lib/graph/relational/workspace.mjs`** — a two-line placeholder, `resolveGraphWorkspace(rootDir)`,
  that returns `deriveProjectKey(rootDir)` directly and documents itself as a stand-in: "Until it
  exists, the `workspace` scope column on every relational graph table is populated from
  `deriveProjectKey`... A real Workspace record replaces this derivation later without changing
  the column shape." This design does not need to change that file — the value it returns is, by
  construction, now exactly this bead's Workspace id (§2.1), so the placeholder's contract is
  already satisfied without a code change. Left as-is; not a file this bead owns.
- **`lib/graph/relational/` storage pattern** (the one the bead's steps name to mirror):
  `sqlite-db.mjs` (lazy `node:sqlite` require behind `sqliteAvailable()`, one db file per project
  under `resolveStateDir(rootDir, '<subdir>')`, `withGraphDb` open/close-in-finally wrapper,
  `PRAGMA journal_mode = WAL`), `migrate-sqlite.mjs` (numbered-file migration runner, its own
  migrations table, transactional apply), `migrations/001_graph_foundation.sql` (CHECK-constrained
  columns, `strftime('%Y-%m-%dT%H:%M:%fZ','now')` timestamp defaults, `IF NOT EXISTS` throughout),
  `schema-version.mjs` (one exported `CURRENT_SCHEMA_VERSION` constant), `sqlite-store.mjs` (CRUD
  functions taking `rootDir` and deriving the workspace scope internally, never a raw db handle
  from the caller).
- **`lib/db/migrate-sqlite.mjs` + `lib/db/migrations/sqlite/001_run_store.sql`** — the M1/`.14`
  fix for exactly the anti-pattern this bead must not repeat: the orchestration run store used to
  create its schema with an inline, unversioned `CREATE TABLE IF NOT EXISTS runs (...)` inside
  `run-store-sqlite.mjs` (disposition-matrix.md C2/D5). `.14` replaced that with a numbered
  migration file applied through a dedicated runner, verified by
  `tests/functional/run-store-identity-convergence.functional.test.mjs` asserting the migration id
  is recorded in the migrations table, "not created via an inline CREATE TABLE."
- **No existing `workspaces` table or `lib/workspace/` module anywhere in the repo** (confirmed:
  `grep -rn "construct_workspaces" lib/` and `ls lib/workspace` both empty/absent before this
  bead's changes). This is new subsystem territory, consistent with target-model.md's own
  Migration note for concept 1 ("does not exist yet").

## 2. Design constraints

1. **Workspace id IS `deriveProjectKey(rootDir)` — no second identity.** The Workspace table's
   primary key is exactly the string `deriveProjectKey` returns; the store never accepts a
   caller-supplied id for a new Workspace, and every public function takes a `rootDir` (mirroring
   `lib/graph/relational/`'s own `rootDir`-in, workspace-key-derived-internally convention) rather
   than a bare id, so there is no code path that can mint a second, competing identity. §11 covers
   the enforcement test.
2. **Versioned migrations from day one.** SQLite via `node:sqlite`, applied through a numbered-file
   migration runner mirroring `lib/graph/relational/migrate-sqlite.mjs` and
   `lib/db/migrate-sqlite.mjs` — never an inline `CREATE TABLE`. This is the exact discipline
   `.14` retrofitted onto the run store; this bead ships it correctly from the first commit
   instead of retrofitting it later.
3. **Lifecycle is `provisioning → active → archived`, forward-only, archived is terminal.**
   Concept 1: "there is no hard-delete of an active workspace with live Work" and "[a]rchiving...
   tombstones it and cascades read-only." No `archived → active` reactivation path is built —
   nothing in target-model.md describes one, and inventing one would be exactly the kind of
   uncited addition CLAUDE.md's no-fabrication rule forbids. If a real need for reactivation
   surfaces later, it is a new, separately-justified bead.
4. **Every other domain table will carry a non-null `workspace` scope column FK'd to this table's
   id** (concept 1's Enforcement clause). Source/Objective/Directive/Work/Policy do not exist yet
   in this repo, so this bead cannot enforce a real foreign key against them — it documents the
   contract (§3.3) so E3/E5/E6/E7/E8 build against a settled convention instead of inventing their
   own scoping shape.
5. **Owner/membership fields seed E7's multi-user authorization without building auth.** Per the
   bead's Security note. §3.2 designs the fields as data, not policy — no access-control
   enforcement is added in this bead (Policy, concept 13, is E6/owns enforcement).
6. **Postgres/shared backend is deferred to E7.** The bead's own Non-goals: "Does not build the
   shared-workspace *server* (E7's job)." A shared Postgres backend is E7's "shared" deployment
   surface, not this bead's. This design still avoids SQLite-only functions in its query surface
   (§10) so a later Postgres port is a port, not a rewrite — the same portability discipline
   `lib/graph/relational/`'s `bindNamedParams`/query-template split already proved, without
   building the second backend now (scope discipline: build what's asked, design so the deferred
   part isn't blocked).
7. **No new `workspace` graph-node type is added to `lib/graph/` in this bead.** The bead's own
   text flags this as optional ("if Workspace-level relationships need graph-backed impact
   analysis... design decision for this bead's lead to make and justify"). Decision: **no**.
   Target-model.md concept 17 (Graph node) is explicit that the full ~35-type ontology, including
   a future `workspace` node type, is "owned by b0nny.2" (E1) — this design supplies domain
   *stores*, not graph *ontology* entries, matching concept 17's own division of labor. Adding a
   `workspace` node type here, ahead of E1's ontology extension, would create exactly the kind of
   uncoordinated graph-schema drift the disposition matrix's D5/C2 lesson warns against for
   *storage* schemas and concept 17 warns against for *node-type* schemas. `lib/graph/relational/workspace.mjs`'s
   existing scope-key stub is sufficient for now and is left untouched (§1).

## 3. Domain schema

### 3.1 `construct_workspaces`

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | `deriveProjectKey(rootDir)` output; never caller-supplied for a new row (constraint 1). |
| `name` | TEXT NOT NULL | Display name; defaults to the root directory's basename if not supplied. |
| `root_path` | TEXT NOT NULL | Canonical (symlink-resolved where possible) local checkout root, matching `deriveProjectKey`'s own path handling. |
| `remote` | TEXT | Canonical git origin remote URL; `NULL` for local-only projects (concept 1 schema: `remote string?`). |
| `deployment` | TEXT NOT NULL DEFAULT `'embedded'` | `CHECK IN ('embedded','shared')` — concept 1 schema field, unchanged. |
| `state` | TEXT NOT NULL DEFAULT `'provisioning'` | `CHECK IN ('provisioning','active','archived')` — concept 1's exact lifecycle. |
| `owner` | TEXT | Free-form owner reference (a member ref, e.g. an email or account id); nullable — a fresh solo workspace may have no formally-recorded owner until one is set. Added field, justified in §3.2. |
| `settings` | TEXT NOT NULL DEFAULT `'{}'` | JSON blob, arbitrary workspace-level configuration. Added field, justified in §3.2. |
| `created_at` | TEXT NOT NULL | ISO-8601, set once. |
| `updated_at` | TEXT NOT NULL | ISO-8601, bumped on every mutation — not in concept 1's schema but needed for any queryable "last changed" answer and consistent with every other relational table in this repo (`last_verified`, `applied_at`, etc.). |
| `archived_at` | TEXT | ISO-8601, set only on the `active → archived` transition; concept 1 schema field, unchanged. |

### 3.2 `construct_workspace_members`

Not present in concept 1's eight-field schema — this is the "membership" half of the bead's
"owner, membership, settings, linked sources, lifecycle" brief, and the concrete answer to why a
plain JSON blob does not suffice for it (unlike `settings`, below): membership needs to be
queryable per-member (bead acceptance criteria: "a durable, queryable entity"), needs a uniqueness
constraint (one row per member per workspace, not an unbounded array a caller could silently
duplicate into), and — per the bead's own Security note — is explicitly named as the seed of
future authorization, which wants a real row shape (`role`) more than a schemaless blob does.

| Field | Type | Notes |
|---|---|---|
| `workspace_id` | TEXT NOT NULL REFERENCES `construct_workspaces(id)` | |
| `member_ref` | TEXT NOT NULL | Free-form identity reference (email, account id); this bead does not define an identity/auth system (E7's job) — it only stores the reference. |
| `role` | TEXT NOT NULL DEFAULT `'member'` | `CHECK IN ('owner','member')`. Deliberately two values, not a richer permission model — Policy (concept 13, E6) is where authorization *rules* live; this table only records *membership*, per concept 13's own "Distinct from Directive" ruling that Workspace/membership data and Policy/authorization rules are separate concerns. |
| `added_at` | TEXT NOT NULL | ISO-8601. |

Primary key `(workspace_id, member_ref)` — a member can appear at most once per workspace.

Why `settings` stays a JSON blob rather than its own key-value table: it has no known key set yet
(nothing in target-model.md or the bead brief enumerates workspace settings), and the repo already
has a direct precedent for exactly this shape — `construct_graph_nodes.attrs` (arbitrary JSON,
`lib/graph/relational/migrations/001_graph_foundation.sql`) and the orchestration run store's
whole-record `json` column (`lib/db/migrations/sqlite/001_run_store.sql`). A key-value table would
be premature structure for a field set nothing has specified yet; promoting specific settings to
real columns (or a normalized table) once real keys exist is a additive migration, not a rewrite.

### 3.3 Relationships to Source, Directive, Policy (bead requirement 1)

None of Source (concept 2), Directive (concept 4), or Policy (concept 13) has a store in this
repo yet — they are E5 (Source, Directive) and E6 (Policy) work. This design cannot build a real
foreign key against a table that does not exist, so what it defines is the **contract** those
epics build against, taken directly from each concept's own target-model.md schema:

- **Source** (`lib/sources`-successor, E5): `Source { id, workspace string, kind,
  connection_ref, cursor, state, last_synced_at }` — the `workspace` field is a non-null FK to
  `construct_workspaces.id`. "Linked sources" (bead brief) is realized as the *inverse* of this
  relationship (`SELECT * FROM sources WHERE workspace = ?`), not a field stored on the Workspace
  row itself — an unbounded array of source ids on the Workspace row would violate the same
  "queryable, not narrative" principle that makes `construct_workspace_members` a real table.
- **Directive** (E5): `Directive { id, workspace string, instruction, trigger, emits, procedures,
  state }` — identical convention, non-null `workspace` FK.
- **Policy** (E6): `Policy { id, workspace string, scope, requires_approval, authority, ... }` —
  identical convention. Policy *governs* effects; Workspace's `owner`/`construct_workspace_members`
  fields *record* who belongs, which is the exact "Distinct from" ruling target-model.md draws
  between Directive and Policy (concept 4: "Directive *produces* work; Policy *governs* whether an
  effect is allowed") extended to Workspace membership vs. Policy authorization — this design
  stores the former, not the latter.

When each of those stores is built, its own migration adds the `workspace` column with a real
`REFERENCES construct_workspaces(id)` (SQLite `PRAGMA foreign_keys = ON`, matching this store's
own choice in §5, not the graph store's deliberate `PRAGMA foreign_keys = OFF` — that pragma
choice was specific to edges being stageable before their endpoint nodes exist during a graph
`build`, which does not apply to a Source/Directive/Policy row referencing an already-provisioned
Workspace).

## 4. Relational schema (DDL)

`lib/workspace/migrations/001_workspace_foundation.sql`, following the exact style of
`lib/graph/relational/migrations/001_graph_foundation.sql` (CHECK-constrained enums, `IF NOT
EXISTS`, `strftime` ISO-8601 defaults):

```sql
CREATE TABLE IF NOT EXISTS construct_workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,
  remote        TEXT,
  deployment    TEXT NOT NULL DEFAULT 'embedded'
                  CHECK (deployment IN ('embedded','shared')),
  state         TEXT NOT NULL DEFAULT 'provisioning'
                  CHECK (state IN ('provisioning','active','archived')),
  owner         TEXT,
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS construct_workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES construct_workspaces(id),
  member_ref    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner','member')),
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, member_ref)
);

CREATE INDEX IF NOT EXISTS construct_workspace_members_workspace_idx
  ON construct_workspace_members (workspace_id);
```

No backend-specific SQL functions (matches constraint 6's Postgres-portability goal); the same
`strftime`/`TEXT` timestamp convention the graph and run stores already use, so a future Postgres
DDL only needs the same `TEXT`→`TIMESTAMPTZ` type substitution `graph-store-design.md` documents
for its own two backends — not a schema redesign.

## 5. Storage location and connection module

One `workspace.db` file per project's machine-scoped state root, mirroring `graphDbPath`'s
pattern exactly: `resolveStateDir(rootDir, 'workspace')/workspace.db`
(`lib/workspace/sqlite-db.mjs`, modeled directly on `lib/graph/relational/sqlite-db.mjs`):

- Lazy `node:sqlite` `DatabaseSync` require behind `sqliteAvailable()`, same Node ≥22.5 boundary
  and same structured `SQLITE_UNAVAILABLE` error/remediation shape as the graph and run stores —
  not a new compatibility boundary.
- `PRAGMA journal_mode = WAL`.
- `PRAGMA foreign_keys = ON` — unlike the graph store (§3.3 explains why the graph store turns
  this off and why that reasoning doesn't transfer here): `construct_workspace_members` rows
  always reference an already-created `construct_workspaces` row through this module's own API
  (there is no "stage the child before the parent" case the way graph edges stage ahead of nodes),
  so real referential integrity is strictly better than a `validate`-time check for this schema.
- `runWorkspaceMigrations(db)` runs on every `openWorkspaceDb` call, idempotent once current — the
  same "safe to call on every connection open" contract `runSqliteMigrations`/`runSqliteMigrations`
  already establish.
- `withWorkspaceDb(rootDir, fn)` open/close-in-`finally` wrapper; every store function uses it
  instead of managing a handle by hand, matching `withGraphDb`.

`lib/workspace/migrate-sqlite.mjs` mirrors `lib/graph/relational/migrate-sqlite.mjs` byte-for-byte
in shape (list migration files, ensure/read the applied-ledger table, apply each not-yet-applied
file in its own transaction) with its own migrations table name,
`construct_workspace_schema_migrations`, and its own `MIGRATIONS_DIR` pointing at
`lib/workspace/migrations/`. A dedicated runner (rather than adding workspace migrations to
`lib/db/migrations/sqlite/`, the orchestration run store's directory) keeps each subsystem's
migration ledger and numbering independent — the same reason the graph store has its own runner
distinct from `lib/db/migrate-sqlite.mjs` rather than sharing the run store's directory and
ledger table.

`lib/workspace/schema-version.mjs` exports one `CURRENT_SCHEMA_VERSION = 1` constant, matching
`lib/graph/relational/schema-version.mjs`'s shape — unused by the DDL itself today (no
`construct_workspace_meta` table needs a stamped version yet, since there is exactly one migration
and no freshness/reconciliation state to track), kept as the seam a second migration or a future
meta table reads, consistent with the graph store's own precedent for the constant's purpose.

## 6. Lifecycle state machine

```
provisioning ──activate──▶ active ──archive──▶ archived
     │                                            ▲
     └──────────────────archive──────────────────┘
```

`STATE_TRANSITIONS = { provisioning: ['active', 'archived'], active: ['archived'], archived: [] }`.

`provisioning → archived` directly (abandoning a workspace before it ever activates) is allowed;
`archived` has zero outbound transitions (constraint 3 — terminal, no reactivation path).
`activateWorkspace`/`archiveWorkspace` both reject (throw a structured `WORKSPACE_INVALID_TRANSITION`
error, not a silent no-op) when the current state has no edge to the requested one — a caller
asking to archive an already-archived workspace gets an explicit error, not a quiet success that
could mask a caller bug.

## 7. Public API / CRUD surface (`lib/workspace/store.mjs`)

This is the contract E3/E7/E8 depend on (bead's own Integration contract note: "changing it later
means touching three dependents") — deliberately narrow, every function keyed by `rootDir` (never
a bare id the caller could mismatch against `deriveProjectKey`):

- `ensureWorkspace(rootDir, { name?, remote?, deployment? } = {})` — get-or-create: returns the
  existing row if present, otherwise creates one in `provisioning` state. Idempotent; the CLI's
  `init` subcommand and any future caller that just wants "a Workspace exists for this rootDir"
  uses this, not `createWorkspace`.
- `createWorkspace(rootDir, opts)` — throws `WORKSPACE_EXISTS` if a row already exists for this
  id; for callers that need to distinguish "created" from "already there."
- `getWorkspace(rootDir)` — returns the row (with `settings` JSON-parsed) or `null`.
- `listWorkspaces(rootDir)` — returns every row in that project's `workspace.db` (in the current
  one-file-per-project embedded layout this is zero-or-one row; kept generic because the schema
  itself does not assume a single-row file, so a future shared-backend port is a storage swap, not
  an API change).
- `updateWorkspace(rootDir, patch)` — `name`/`remote`/`deployment`/`owner`; bumps `updated_at`.
  Does not accept `state` (lifecycle changes go through the dedicated transition functions below,
  so every state change is validated against `STATE_TRANSITIONS`, never bypassed via a generic
  patch).
- `activateWorkspace(rootDir)` / `archiveWorkspace(rootDir)` — validated lifecycle transitions
  (§6); `archiveWorkspace` also stamps `archived_at`.
- `addMember(rootDir, memberRef, { role = 'member' } = {})` — upsert (re-adding an existing member
  updates their role rather than erroring, so a "promote to owner" call is just `addMember(...,
  { role: 'owner' })`).
- `removeMember(rootDir, memberRef)`.
- `listMembers(rootDir)`.
- `getSettings(rootDir)` / `getSetting(rootDir, key)` / `setSetting(rootDir, key, value)` —
  read-modify-write over the `settings` JSON blob; `setSetting` is the only mutator, so every
  settings write goes through one code path that also bumps `updated_at`.

No hard-delete/purge function is built — concept 1's Deletion behavior explicitly scopes purge as
"a separate, explicit, out-of-band operation that removes all scoped stores together," which
cannot be built meaningfully before Source/Objective/Directive/Work/Policy stores exist to be
included in it (§14).

## 8. CLI surface (`lib/workspace/cli.mjs`, `construct workspace-domain ...`)

The CLI verb is `workspace-domain`, not `workspace` — `bin/construct` already binds `workspace` to
`cmdWorkspace` (`lib/embed/workspaces.mjs`), the pre-existing multi-PM product-intelligence
"customer profiles and multi-PM workspaces" feature (`construct workspace list|create|show|assign`,
documented above under "Product intelligence" in `docs/guides/concepts/architecture.mdx`) — a
distinct concept from target-model.md's Workspace. `bin/construct`'s command map is a `Map`, so a
second `['workspace', ...]` entry would silently shadow the existing command rather than error;
this was caught by re-testing after wiring the first draft and fixed before this became a
regression (§15 records it as a build-time correction).

Mirrors `lib/graph/cli.mjs`'s dispatch shape (`runWorkspaceCli(args, { projectDir })`, `--json`
flag, numeric exit codes, `process.stdout.write`/`process.stderr.write` rather than `console.*`)
and is wired into `bin/construct`'s command map the same way `graph`/`matrix` are:

- `init [--name=] [--remote=] [--deployment=embedded|shared]` → `ensureWorkspace`.
- `show [--json]` → `getWorkspace`; prints "no workspace" (exit 1) if `ensureWorkspace`/`init`
  was never run for this rootDir.
- `activate` / `archive` → the lifecycle transitions.
- `member add <ref> [--role=owner|member]` / `member remove <ref>` / `member list [--json]`.
- `settings get <key>` / `settings set <key> <value>` / `settings list [--json]`.

This is the CLI surface the bead's required functional test (CLAUDE.md's CLI+durable-state
combination) drives end-to-end, the same way
`tests/functional/graph-relational-store.functional.test.mjs` drives `construct graph ...`
against real state.

## 9. Reconciliation with M1 — enforcement

Constraint 1 is tested directly, not just asserted in prose: a functional test (§12) creates a
fixture git repo, computes `deriveProjectKey(repo)` independently, calls `ensureWorkspace(repo)`,
and asserts the returned/stored `id` equals the independently-computed key — the same shape
`run-store-identity-convergence.functional.test.mjs` already uses for the run store's own
identity convergence proof, extended to this new store. A unit test additionally asserts that no
public function in `lib/workspace/store.mjs` accepts a raw workspace id as an argument (the whole
public surface is `rootDir`-keyed), which is what actually forecloses a second-identity code path
rather than merely documenting the intent.

## 10. Query surface

No recursive traversal, no outbox, no reconciliation-against-a-seed exists for this store — unlike
the graph store, Workspace rows are never *derived* from another source of truth; they are
directly authored via CRUD, so §4–7 of `graph-store-design.md` (incremental update, reconciliation,
recursive-CTE traversal) have no analogue here and are deliberately not built. The only "query
surface" is the CRUD/lifecycle functions in §7 plus direct `SELECT`s scoped by `workspace_id` for
membership — both already covered above.

## 11. Assumptions register

| ID | Assumption | Supporting | Opposing | If wrong | Test |
|---|---|---|---|---|---|
| AW1 | `owner`/`construct_workspace_members` as plain data (no enforcement) is the right cut for this bead, leaving all authorization to Policy/E6/E7 | Concept 13's own "Distinct from Directive" ruling separates *generation* from *governance*; the bead's Security note says "even though E7 builds the actual auth" | A future E7 design could find membership needs richer attributes (invitation state, scopes) than `role enum(owner,member)` | Add columns via a new numbered migration (additive, not a rewrite) | E7's own design bead is the test — if it needs more than `role`, that bead extends this schema |
| AW2 | `settings` as a single JSON blob (not a key-value table) is adequate until real setting keys are specified | Direct precedent: `construct_graph_nodes.attrs`, the run store's whole-record `json` column | A high-write-frequency individual setting could contend on the single blob's read-modify-write | Promote a specific hot setting to its own column or a `construct_workspace_settings` table in a new migration | No test today (nothing writes settings at volume yet); revisit if/when a real setting exists |
| AW3 | One `workspace.db` file per project (not a single machine-wide file across all projects) is the right embedded-mode layout | Mirrors `graph.db`'s exact per-project placement (`resolveStateDir(rootDir, 'graph')`); consistent with every other per-project store in this repo | A future "list every workspace on this machine" CLI (not required by this bead) would need to walk `~/.construct/projects/*/workspace/workspace.db` rather than one query | Add a directory-walk helper later; no schema change needed since `listWorkspaces` is already per-file-generic (§7) | Not tested here — no cross-project listing capability is being built |

## 12. Day-one proof — functional test traceability

The bead's acceptance criteria ("a working, versioned-migration-backed Workspace store with CRUD
+ lifecycle transitions, covered by a functional test") is proven by
`tests/functional/workspace-domain.functional.test.mjs`, driving the real `construct workspace-domain`
CLI against an isolated sandbox (mirroring
`tests/functional/graph-relational-store.functional.test.mjs`'s and
`tests/functional/run-store-identity-convergence.functional.test.mjs`'s isolation pattern —
`CX_HOME_OVERRIDE` redirected to a tmpdir, a real git fixture repo, `rmTmpDir` teardown):

1. `construct workspace-domain init` on a fresh fixture repo creates a `provisioning` workspace whose id
   equals `deriveProjectKey(repo)` computed independently (§9's M1-reconciliation proof).
2. `construct workspace-domain show` round-trips the created row, including default `deployment: embedded`.
3. `construct workspace-domain activate` transitions `provisioning → active`; a second `activate` call
   fails (no self-transition).
4. `construct workspace-domain member add`/`member list`/`member remove` round-trip membership, including
   the owner-role upsert case.
5. `construct workspace-domain settings set`/`settings get` round-trip a setting through the JSON blob.
6. `construct workspace-domain archive` transitions `active → archived`, stamps `archived_at`; a
   subsequent `activate` is rejected (terminal state, §6).
7. Direct SQLite inspection (mirroring `run-store-identity-convergence.functional.test.mjs`'s own
   `DatabaseSync` inspection) confirms `construct_workspace_schema_migrations` recorded
   `001_workspace_foundation` as applied — proving the schema came from the versioned migration
   path, not an inline `CREATE TABLE` (the exact D5/C2 regression this design must not reintroduce,
   constraint 2).

## 13. Handoff to build (this bead, self-handoff)

Since this bead is single-lead design-then-build (unlike `.2`→`.3`, which split across two
beads), there is no cross-bead handoff — the build proceeds directly from §3–§8 above in this same
session, in the order: migration SQL (§4) → connection module (§5) → store CRUD/lifecycle (§7) →
CLI (§8) → functional test (§12) → unit tests (§9's enforcement proof) → `bin/construct` wiring →
docs (CHANGELOG, architecture.mdx) → `construct doctor` + full suite.

## 14. What this document deliberately does not do

- It does **not** build Source, Objective, Directive, Work, Work Specification, Plan, or Policy
  stores — those are E3/E5/E6, each already scoped a `workspace` FK by §3.3's contract.
- It does **not** build the shared-workspace *server*, Postgres backend, or any multi-user
  authorization/auth enforcement — that is E7 (bead's own Non-goals).
- It does **not** add a `workspace` node type to `lib/graph/`'s ontology — that is E1/`.2`'s
  ontology-extension scope (§2 constraint 7).
- It does **not** build a hard-delete/purge path — concept 1 explicitly scopes purge as a
  separate, later, cross-store operation that cannot be meaningful before the stores it would
  cascade across exist.
- It does **not** change `lib/state-root.mjs`, `lib/orchestration/store.mjs`, or
  `lib/embed/daemon.mjs` — M1 already converged those; this design reuses `deriveProjectKey`
  read-only and adds no new identity derivation anywhere.

## 15. Correction found building this bead (post-design, pre-merge)

The first implementation draft wired the CLI as `['workspace', ...]` in `bin/construct`'s
`handlers` Map, which — because `Map` construction silently lets a later entry overwrite an
earlier one with the same key — would have shadowed the pre-existing `['workspace', cmdWorkspace]`
entry (`lib/embed/workspaces.mjs`'s multi-PM product-intelligence command, unrelated to this
concept) rather than erroring at load or test time. Caught by re-reading
`docs/guides/concepts/architecture.mdx`'s "Product intelligence" section while drafting this
document's own doc updates, confirmed by grepping `bin/construct` for the existing binding, and
fixed by renaming this bead's CLI verb to `workspace-domain` before any commit — §8 and the
functional test (§12) reflect the corrected name throughout, and no version of the shadowing
behavior was ever exercised by a passing test (the collision was caught by direct code inspection
during the docs pass, not by a test failure).
