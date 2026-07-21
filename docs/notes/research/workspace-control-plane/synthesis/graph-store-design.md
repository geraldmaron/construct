---
intake: none
---

# Relational Graph Store — Design

Authored 2026-07-17 for bead `construct-b0nny.2` (WS3b, epic `construct-b0nny`), the
graph-schema/builder **design** task. Single strong lead, no fan-out per
[subagents/routing-plan.md](../subagents/routing-plan.md) (WS3b: "single strong lead,
strongest tier"). This design does **not** build the store — that is `construct-b0nny.3`,
which depends on this document — and it does **not** run the validation spike — that is
`construct-b0nny.5` (Validation Spike A), for which this document supplies the measured-workload
plan.

Inputs read in full and re-verified against the worktree on branch
`chore/b0nny.2-graph-schema-design` @ `9254bd10` (forked from `feat/workspace-control-plane`):
[directive.md](../directive.md) §4, [synthesis/target-model.md](target-model.md) (all 18
concepts + relationship map), [subagents/graph-and-state-audit.md](../subagents/graph-and-state-audit.md),
[baseline.md](../baseline.md), and the live `lib/graph/` source. Naming follows program rule 1:
every name describes a capability; no `v2`/`next`/`new-` names appear.

Companion DDL and query templates (runnable, for Spike A):
- [graph-store/ddl-sqlite.sql](graph-store/ddl-sqlite.sql) — embedded backend
- [graph-store/ddl-postgres.sql](graph-store/ddl-postgres.sql) — shared backend
- [graph-store/queries.sql](graph-store/queries.sql) — portable recursive-CTE query surface

---

## 0. Assumption A3 — resolved before designing (ff17508e / change-intent)

The bead says to "check assumption A3 (change-intent branch `ff17508e` landed on main) at
start." **Resolved negative and re-verified in this worktree.** `find . -name change-intent.mjs`
returns nothing under `lib/graph/`; the current `lib/graph/` is 17 files (store, builders,
queries, staleness, validate, cli), none of them `change-intent.mjs`. [baseline.md](../baseline.md)
records that `ff17508e` / `lib/graph/change-intent.mjs` existed **only** on
`feat/bead-sprint-20260717`, confirmed by `git merge-base --is-ancestor` negative; per the bead
brief that branch and `chore/post-tsyfe8-batch-20260717` were both deleted 2026-07-17 (discarded,
not merged). **Consequence for this design:** change-intent *declaration* — "every implementation
bead declares graph nodes it creates/changes/deprecates/deletes" (directive §4) — is treated as
**in-scope to design here, not pre-existing**. It is designed fresh as the `declared` flag on the
transactional-outbox event (§4 below), not as a dependency on a deleted module.

## 1. What already exists (re-verified, not assumed)

Grounded in `lib/graph/store.mjs` (read this session):

- **16 node types** (`NODE_TYPES`, store.mjs:36-39): file, module, workflow, capability, test,
  contract, surface, skill, rule, provider, tool, pack, doc, specialist, runtime-evidence, embed.
  Canonical id `type:key` (`nodeId`, store.mjs:57-59).
- **16 edge relations** (`EDGE_RELS`, store.mjs:41-44): imports, realizes, validates, covers,
  exposes, governed_by, uses, embeds, co_changes, contains, requires, documents, evidenced_by,
  owned_by, reads, secures. Directed; `weight` **summed on de-dup** keyed by `from|rel|to`
  (`normalizeEdges`, store.mjs:111-125); `sources[]` provenance from a fixed set (`EDGE_SOURCES`,
  store.mjs:46: registry, import-graph, co-change, override, corpus-annotation, runtime-evidence,
  embed-manifest).
- **Storage:** JSONL — `nodes.jsonl` (sorted by id), `edges.jsonl` (sorted by from|rel|to),
  `meta.json` (schemaVersion, generatedAt, sourceHash, **sourceHashes** per-source map, counts;
  store.mjs:149-167). Atomic temp-then-rename (`writeAtomic`, store.mjs:90-94). In-memory `out`/`in`
  adjacency for O(degree) `dependenciesOf`/`dependentsOf` (store.mjs:187-216). Pure JS, no DB.
- **Staleness** (`staleness.mjs`): per-source seed hashing over named `SOURCE_GROUPS` (registry,
  overlays, specialistsOrg, plugins, providerManifests, workflowManifests; staleness.mjs:109-133)
  so drift reports *which* source moved; plus execution staleness (`neverExecuted` vs aged-out).
- **Impact** (`impact.mjs`): `reverseImportClosure` over `imports` edges → affected tests; caps via
  `realizes`; workflows via `embeds`. Conservative over-selection by design (impact.mjs:24-108).
- **Reconciliation:** detect drift → **full rebuild only**; no diff-apply (audit part A, store has
  no incremental path — every `runBuild` regenerates).

The existing model is real and populated (audit: 3,250 nodes / 8,522 edges live in the primary
checkout). The port keeps its semantics; it changes the *implementation shape* to relational
SQLite/Postgres and adds the four capabilities the audit found missing (relational storage,
recursive-SQL traversal, incremental update, generic cycle/orphan/path queries).

## 2. Design constraints (from the directive, load-bearing)

1. **Two backends, one product model** — SQLite embedded (solo/local, `node:sqlite` DatabaseSync,
   Node ≥22.5, same boundary as `run-store-sqlite.mjs`) and Postgres (shared/multi-workspace).
   Identical semantics; identical query results (directive §4 day-one milestone). No graph
   database unless Spike A proves relational cannot meet the workload (directive §4, §13: "no
   required graph database").
2. **Relational node + typed-edge tables, recursive SQL traversal, transactional updates,
   transactional outbox** (directive §4).
3. **Per-node/edge metadata:** stable id, type, version, workspace scope, source of truth,
   provenance, confidence, first-observed/last-verified, lifecycle (active/deprecated/superseded/
   deleted/unknown), owning subsystem, rebuild strategy, conflict status. Inferred distinguishable
   from declared; the graph is never authoritative — `source_of_truth` points back to the domain
   store (directive §4; target-model concept 17).
4. **No generic `related-to`** edge collapse (directive §4). The bounded, named edge set is a hard
   constraint.
5. **Incremental on change; full rebuild available for reconciliation but not required in normal
   operation** (directive §4).
6. **Local-first, no always-on cloud, clean uninstall** (directive §13). The incremental applier
   runs in-process (hook / doctor watcher / CLI), not as a mandatory daemon.

## 3. Relational schema

One logical schema, two physical DDLs. Tables (full DDL in the companion `.sql` files):

| Table | Purpose | Ports / adds |
|---|---|---|
| `construct_graph_nodes` | typed nodes, PK `(workspace,id)` | store.mjs node `{id,type,name,attrs}` + directive §4 metadata columns |
| `construct_graph_edges` | typed directed edges, PK `(workspace,from_id,rel,to_id)` | store.mjs `edgeKey` de-dup + summed `weight`; adds `inferred`, `confidence`, `state` |
| `construct_graph_meta` | per-workspace singleton | store.mjs `meta.json` + `freshness` state slot |
| `construct_graph_source_hash` | per-source seed hash | staleness.mjs `SOURCE_GROUPS` → one row per source |
| `construct_graph_outbox` | transactional outbox | **new** — incremental update + change declaration |
| `construct_graph_applied_log` | applied-event ledger | **new** — reconciliation gap detection |

**Backend differences are types only** (documented in the DDL headers): `TIMESTAMPTZ`→`TEXT`
ISO-8601, `BOOLEAN`→`INTEGER 0/1`, `JSONB`→`TEXT`, `BIGSERIAL`→`INTEGER PRIMARY KEY AUTOINCREMENT`.
Table names, column names, and CHECK vocabularies are identical so `queries.sql` runs unchanged on
both and a parity harness asserts equal result sets.

**No edge→node foreign key** (deliberate; DDL header explains): build unions all seeders before
writing (`runBuild`), so an edge can be staged before its endpoint; and `ON DELETE CASCADE` would
silently drop edges on node deletion, defeating the change-impact gate whose job is to *block* a
deletion that leaves active inbound edges. Referential integrity is a `validate` finding instead,
mirroring the existing `validate.mjs` dangling-`secures` check.

**Provenance** lives as `provenance_sources` (JSON array, ported from `sources[]`) plus a derived
`inferred` boolean on edges for fast "declared vs discovered" filtering (directive §4). If
per-source-per-edge attributes prove necessary (assumption **AG4**), promote to a normalized
`edge_source` table — this is the same edge-vs-record tension as target-model's **A8** on Evidence.

**Migration versioning** follows the existing Postgres runner (`lib/db/migrate.mjs`): numbered
`NNN_*.sql` files applied transactionally, tracked in `construct_schema_migrations`. The SQLite
store gets **real migration files too**, not the inline unversioned schema the audit flags on the
run store (D5) — b0nny.3 ships a small SQLite migration runner mirroring `migrate.mjs`.

## 4. Incremental update — transactional outbox

The directive requires "incremental update on relevant changes" and "a transactional outbox for
graph-affecting events" (§4). Design:

**Write path (one transaction).** A domain mutation (a bead landing nodes, a manifest edit, a
completed run) commits, *in the same transaction*, one or more `construct_graph_outbox` rows
describing the graph delta (`node_upsert` / `node_delete` / `edge_upsert` / `edge_delete` /
`source_rehash`). Because the domain write and the outbox row share a transaction, a crash between
them is impossible — the event is never lost. A bead's **declared** graph changes (directive §4)
are outbox rows with `declared = true`; discovered/runtime deltas are `declared = false`. This is
the change-intent-declaration capability, built here rather than assumed (§0).

**Apply path (in-process, idempotent).** An applier drains pending rows in `outbox_id` order
(`queries.sql` outbox-drain), applies each payload to the node/edge tables via upsert (node upsert
merges `attrs` last-write-wins, edge upsert sums `weight` — exactly `normalizeNodes`/
`normalizeEdges` semantics), appends the applied `outbox_id` as a `seq` to
`construct_graph_applied_log`, and marks the row `applied` — all in one transaction per batch.
Idempotency: re-applying an already-applied `seq` is a no-op (PK conflict on the applied-log),
so a crash mid-batch is safe to retry. The applier is triggered by the existing surfaces — the
`graph-impact-advisory` PostToolUse hook, the doctor `graph-staleness` watcher, or an explicit
`construct graph update` — never a mandatory daemon (directive §13).

**Outbox event state machine.**

```
 pending ──claim──▶ applying ──ok──▶ applied
    ▲                   │
    │                   └──error──▶ failed ──(attempt<max)──▶ pending
    │                                   │
    └───────────────────────────────────┘
                                        └──(attempt==max)──▶ dead_letter ──▶ [forces reconciliation]
```

A `dead_letter` event (a delta that cannot be applied after `max_attempts`) is a **trust-loss
signal**: the incremental state may now be wrong, so the reconciliation decision (§5) forces a
full rebuild rather than trusting incremental state.

## 5. Reconciliation — diff-based, against a full rebuild

Incremental keeps the graph fresh cheaply; reconciliation periodically *proves* the incremental
state is still correct by comparing it to a fresh full rebuild. This is "full rebuild remains
available for reconciliation but normal operation must not require it" (directive §4).

**Trust decision — when incremental is trusted vs when a full rebuild is forced.**

Trust the incremental state (no rebuild) when **all** hold:
- outbox fully drained — zero `pending`/`failed`/`dead_letter` rows;
- applied-log continuous — no gap in per-workspace `seq` (`queries.sql` gap-check);
- every `construct_graph_source_hash` matches the freshly computed hash (staleness.mjs
  `computeSourceHashes`) — no source drifted outside the outbox;
- `schema_version` matches the migration head;
- no node carries `conflict_status = 'contested'` above the configured tolerance.

Force a full rebuild when **any** hold:
- a `dead_letter` outbox event exists (a delta could not be applied);
- a source hash moved for a source **not** covered by an outbox delta — the tell-tale of a bulk
  external edit, `git checkout`, or branch switch that bypassed the write path;
- an applied-log `seq` gap (an event was lost);
- `schema_version` mismatch (a migration changed the shape);
- a scheduled reconciliation interval elapsed (belt-and-suspenders; proposed default: on
  `construct doctor`, and once per N days — value set by Spike A).

**Reconciliation procedure (diff-based).** Build a fresh graph from the seeders into a **shadow**
table set (or a shadow workspace id), then diff shadow vs live: `added` (in shadow, not live),
`removed` (in live, not shadow, still `active`), `changed` (same key, different attrs/weight/
lifecycle). Then:
- **empty diff** → incremental state is proven correct; update `last_reconciled_at`, set
  `freshness = 'fresh'`. This is the healthy path — incremental was trustworthy.
- **non-empty diff** → the incremental state had drifted. Apply the diff to live (or swap
  shadow→live atomically) **and** record a reconciliation report naming what drifted and its
  likely cause (which source, whether an outbox event was missing) — the diff is both the
  correction and the diagnosis of which incremental hook is incomplete.

**Graph freshness state machine** (`construct_graph_meta.freshness`).

```
 fresh ──outbox row enqueued──▶ incremental_dirty ──applier drains ok──▶ fresh
 fresh ──source hash moved (no matching delta)──▶ source_drift ──▶ rebuilding ──▶ fresh
 incremental_dirty ──dead_letter / applier error──▶ suspect ──▶ rebuilding ──▶ fresh
 fresh ──scheduled / doctor──▶ reconciling ──(empty diff)──▶ fresh
                                          └──(non-empty diff)──▶ rebuilding ──▶ fresh
```

## 6. Recursive-CTE traversal (portable)

All traversal moves from JS BFS/DFS (`impact.mjs`, `store.mjs` adjacency) to `WITH RECURSIVE`.
Portability rules (so SQLite and Postgres return identical rows — directive §4):
- **TEXT path accumulator** (`'|'||id||'|'` concatenation), not Postgres arrays;
- **LIKE-based cycle guard** (`path NOT LIKE '%|'||id||'|%'`), not `instr`/`strpos` (function names
  differ);
- **bounded depth** (`depth < :max_depth`) — implements the directive's "first-order and bounded
  transitive dependents";
- **aggregation in the store layer**, not `group_concat`/`string_agg` (names differ).

Templates for down/up/path/cycles/orphans/owners/requirements/impact/drift/explain/export are in
[graph-store/queries.sql](graph-store/queries.sql). The `down` (dependents) and `up` (dependencies)
templates are the direct recursive-CTE ports of `store.mjs` `dependentsOf`/`dependenciesOf`; the
`impact` template is the port of `impact.mjs` `reverseImportClosure` + test selection.

## 7. Query surface — directive §4.8

The directive's condensed command surface (directive.md:80-81, faithful extraction of source §4.8;
the condensed directive does not carry the source PDF's sub-numbering — [baseline.md](../baseline.md)
records the condensation) is: **build, update, validate, query, impact, path, owners, requirements,
orphans, cycles, drift, explain, export.** Every capability is mandatory; names are flexible.

| Command | Capability | Backing | Maps to existing |
|---|---|---|---|
| `build` | full regenerate into tables (seeders → bulk upsert) | insert; `meta` + `source_hash` written | `runBuild` (cli.mjs) |
| `update` | drain outbox, apply incremental deltas | outbox-drain + applied-log | **new** (no incremental path today) |
| `validate` | integrity: dangling edges, requires-integrity, coverage, handoff cycles | SQL predicates + `cycles` | `validate.mjs` |
| `query` | node lookup, by-type, adjacency | `explain` + up/down templates | node-id query, `nodesByType` |
| `impact` | change-impact gate (affected tests/caps/contracts/schemas, required migrations/tests) | `impact` CTE + type filters | `impact.mjs` `computeImpact` |
| `path` | shortest directed path between two nodes | `path` CTE | **new** (no path query today) |
| `owners` | owning subsystem + owned-by targets | `owners` template | node `owner` + `owned_by` edges |
| `requirements` | direct + transitive dependency lookup | `requirements` + `up` CTE | `gap-queries.mjs` `findDependencies` |
| `orphans` | unreferenced nodes / orphaned capability | `orphans` + typed variant | **new** (no orphan query today) |
| `cycles` | relation-scoped cycle detection | `cycles` CTE | **new** (only workflow-handoff cycles today) |
| `drift` | per-source hash staleness + execution staleness | `drift` query + staleness.mjs recompute | `staleness.mjs`, `findStale` |
| `explain` | node detail + provenance + lifecycle | `explain` template | `runExplain` |
| `export` | JSON dump + mermaid/DOT diagram | `export` templates + store-layer render | **new** (JSONL round-trip today) |

Five of the thirteen are the missing generic queries the directive calls for and the audit found
absent: `path`, `orphans`, `cycles`, whole-graph `update` (incremental), and `export` diagram.

## 8. Ontology mapping — existing (16/16) → target (~35/~30)

The target ontology is directive §4's ~35 node types and ~30 edge types
(directive.md:55-62), the domain slice of which is fixed by
[target-model.md](target-model.md). Below, every existing type maps to its target equivalent;
target types with no existing source are marked **NEW**.

### 8.1 Node types (existing 16 → target)

| Existing node | Target node | Shape | Basis |
|---|---|---|---|
| capability | capability | **1:1 exact** | target-model concept 12 ("already exists in the target shape") |
| test | test | **1:1 exact** | directive §4 lists `test` |
| workflow | procedure | **1:1 rename** | target-model concept 11 (`workflow` node → `procedure` node) |
| specialist | worker profile | **1:1 rename** | target-model concept 10 ("replacing the current specialist node type") |
| doc | documentation surface | **1:1 rename** | directive §4 `documentation surface` |
| provider | adapter (1 of 4 kinds) | **1:1 rename** | directive §4 "four adapter kinds"; provider is an adapter |
| file | module | **1:1 re-tier** | finest existing code unit → directive `module` |
| tool | public interface | **1:1 re-tier** | a tool is the callable interface an adapter exposes (directive `public interface`) |
| rule | policy | **1:1 merge-flavored** | governance constraint → directive `policy` (target-model concept 13) |
| runtime-evidence | evaluation | **1:1 re-map** | execution-outcome record → directive `evaluation`; also seeds Run `evidenced_by` (target-model concept 8) |
| module | package | **merge** | dir-level grouping (`contains` files, build-co-change.mjs:39,51) → `package`, shared with `pack` |
| pack | package | **merge** | installable bundle → `package`, shared with `module` |
| contract | capability | **merge** | handoff contract folds into the capability's contract (target-model concept 12: source of truth = registry + `specialists/org/contracts/`) |
| skill | worker profile | **merge** | skill-emphasis input to a profile (target-model concept 10: "personas become skill-emphasis inputs") |
| surface | CLI command / API route / documentation surface | **split** | coarse surface node → finer directive interface types; existing data is dominantly CLI |
| embed | — (demoted) | **drop** | vector store is delegated (directive §3, §13 "no required vector database"); its `reads` authority edge is retained |

**Headline (nodes).** Of the 16 existing node types: **10 map 1:1** to a distinct target type (2
exact names — capability, test; 8 renamed/re-tiered — workflow→procedure, specialist→worker
profile, doc→documentation surface, provider→adapter, file→module, tool→public interface,
rule→policy, runtime-evidence→evaluation); **4 merge** into a shared target (module+pack→package;
contract→capability; skill→worker profile); **1 splits** (surface → CLI command / API route /
documentation surface); **1 is demoted** out of the core ontology (embed → delegated vector
subsystem). Distinct target node types with an existing source: **~12**. **~23 target node types
are genuinely NEW** (no existing source): workspace, objective, directive, work, work-spec version,
plan version, assignment, source, three of the four adapter kinds, schema, durable record type,
API route, event type, configuration field, artifact type, evidence requirement, security control,
deployment component, migration, ADR, bead/tracker item. These new types are the domain the graph
never modeled — the work/governance layer the control plane adds.

### 8.2 Edge relations (existing 16 → target)

| Existing rel | Target rel | Shape |
|---|---|---|
| validates | validates | **1:1 exact** |
| exposes | exposes | **1:1 exact** |
| contains | contains | **1:1 exact** |
| owned_by | owned-by | **1:1 exact (hyphen)** |
| reads | reads | **1:1 exact** |
| imports | depends-on | **1:1 rename** |
| realizes | implements | **1:1 rename** |
| covers | tested-by | **1:1 rename (inverse dir)** |
| governed_by | governs | **1:1 rename (inverse dir)** |
| uses | consumes | **1:1 rename** |
| co_changes | affected-by | **1:1 rename** |
| documents | documented-by | **1:1 rename (inverse dir)** |
| evidenced_by | verifies | **1:1 rename** (target-model concept 15 keeps `evidenced_by` as the seed) |
| requires | depends-on | **merge** (joins imports) |
| embeds | contains | **merge** (joins contains) |
| secures | governs | **merge** (joins governed_by) |

**Headline (edges).** Of the 16 existing edge relations: **5 map 1:1 exact** (validates, exposes,
contains, owned_by→owned-by, reads); **8 map 1:1 renamed** (imports→depends-on, realizes→implements,
covers→tested-by, governed_by→governs, uses→consumes, co_changes→affected-by, documents→
documented-by, evidenced_by→verifies); **3 merge** into an already-mapped target (requires→
depends-on, embeds→contains, secures→governs). Distinct target edges with an existing source: **13**.
**16 target edges are genuinely NEW**: produces, calls, writes, authorizes, projects-to,
executed-by, compatible-with, supersedes, migrates, deprecates, deletes, blocks, conflicts-with,
evaluated-by, deployed-by, sourced-from — the work-lifecycle, governance, and change-management
edges the control plane adds.

### 8.3 Provenance-source mapping

Existing `EDGE_SOURCES` (store.mjs:46) map to the directive §4 source classes (declared / discovered
/ runtime-observed) and set the derived `inferred` boolean:

| Existing source | Directive class | `inferred` |
|---|---|---|
| registry | declared | false |
| override | declared | false |
| corpus-annotation | declared | false |
| embed-manifest | declared | false |
| import-graph | discovered | true |
| co-change | discovered | true |
| runtime-evidence | runtime-observed | true |

## 9. Day-one milestone (directive §4.11) — design traceability

The milestone (directive.md:93-97; the condensed directive does not carry the source's §4.11
sub-number — cited as content per [baseline.md](../baseline.md)) is satisfied as follows:

| Milestone step | Design element |
|---|---|
| register nodes | `build` → `construct_graph_nodes` upsert |
| derive edges | seeders (declared/discovered/runtime) → `construct_graph_edges` |
| incremental update | outbox drain (§4) |
| query up/downstream | `up`/`down` recursive CTEs (§6) |
| detect deliberate cycle | `cycles` CTE (§6, §7) |
| detect orphaned capability | typed orphan query (§7) |
| impact report for a changed schema | `impact` CTE over a `schema` node (NEW node type) |
| identify affected tests/adapters | `impact` with node_type filter (test, adapter) |
| block a change omitting required validation | change-impact gate returns incomplete → completion blocked (directive §4; target-model concept 5 Work acceptance) |
| export JSON + human-readable diagram | `export` templates + store-layer mermaid/DOT |
| equivalent results on SQLite and Postgres | portable query text + parity harness (§6, Spike A) |
| rebuild and reconcile against incremental state | reconciliation diff (§5) |

## 10. Measured-workload plan — Validation Spike A

Spike A (directive §11 A, owned by `construct-b0nny.5`) proves §4 on relational SQLite/Postgres.
This plan makes it runnable against the companion DDL. Spikes are disposable and never merged
unless a later bead adopts them (directive §11).

**Corpus.** The live construct graph — **3,250 nodes / 8,522 edges** (audit part A, primary
checkout) — is the baseline workload. Plus synthetic scale-ups at **10× (~85k edges)** and **100×
(~850k edges)** by structure-preserving replication, to probe recursive-CTE latency past the real
size. Both backends load the identical corpus.

**Measurements and proposed thresholds** (thresholds are *proposed targets, validated by the
spike* — not measured here; do not cite as results):

| # | Measure | Method | Proposed target |
|---|---|---|---|
| 1 | Full build (bulk load) time | seed → bulk upsert, both backends | ≤ 5 s @ 8.5k edges |
| 2 | Incremental update latency | one changed file → outbox → apply | ≤ 250 ms (hook budget) |
| 3 | Query latency (up/down/path/impact) | p95 over 100 random roots @ 8.5k and 85k edges | ≤ 100 ms @ 8.5k; ≤ 1 s @ 85k |
| 4 | Cycle / orphan detection latency | scoped cycle scan + orphan scan @ each scale | ≤ 1 s @ 8.5k |
| 5 | **Impact correctness** | run `impact` CTE vs `impact.mjs` `computeImpact` on the same changed-file sets; assert identical `affectedTests`/`impactedCapabilities` | **exact match** (the JS result is ground truth — A1 port-equivalence) |
| 6 | Reconciliation correctness | build incremental state, skip one known outbox delta, reconcile; assert the diff catches exactly the skipped delta | exact catch |
| 7 | Storage footprint | DB file size vs JSONL bytes | within 2× |
| 8 | Migration burden | count migration files / LOC to stand up both schemas | ≤ ~3 files/backend |
| 9 | **Cross-platform parity** | every §4.8 query, both backends, same corpus; assert equal result sets | **byte-equal** (directive §4 milestone) |
| 10 | Dependency count | third-party deps added beyond `node:sqlite` + the existing Postgres client | 0 new |

**Go / no-go.** Relational meets the workload (adopt for E1) iff: incremental (#2) within hook
budget **and** query p95 (#3) within interactive threshold **and** impact-correctness (#5) exactly
matches the JS baseline **and** cross-platform parity (#9) holds. If recursive-CTE latency fails at
scale (#3/#4), that is precisely the evidence the directive's escape hatch requires ("no graph
database unless a spike proves relational cannot meet the workload", directive §4) — the spike is
where that proof would surface. This is assumption **A1** (relational traversal meets the workload),
carried from Wave 0 and target-model §Contradictions; this design states the target shape and defers
the load verdict to the spike.

## 11. Assumptions register (this design)

| ID | Assumption | If wrong | Test |
|---|---|---|---|
| A3 | change-intent declaration is NOT pre-built anywhere reachable (ff17508e discarded) | — (resolved negative; designed fresh as outbox `declared`) | `find` (done); baseline.md merge-base evidence |
| A1 | recursive-CTE traversal on the live 8.5k-edge corpus meets the interactive budget | fall back to a materialized adjacency projection, or (last resort) a graph DB | Spike A #3/#4 |
| A2 | the existing 16/16 semantics extend to the ~35/~30 ontology | re-partition the code/infra tier | this mapping (§8) is A2's artifact; two renames + re-tiers, no semantic loss |
| AG1 | the incremental applier runs within a hook/doctor budget without an always-on daemon | batch incremental at session boundaries | Spike A #2 |
| AG2 | cross-backend parity holds with LIKE cycle guards + TEXT path accumulation (no Postgres arrays) | per-backend query variants behind a parity test | Spike A #9 |
| AG3 | node/edge provenance as `provenance_sources` JSON + `inferred` bool is sufficient | promote to a normalized `edge_source` table (mirrors A8) | b0nny.3 build; Spike A #5 |
| AG4 | the code/infra node tier re-partition (file→module, module/pack→package, tool→public interface, surface→CLI command) is faithful | keep existing granularity as extra node types | b0nny.3 build against live data |

## 12. Handoff to construct-b0nny.3 (build)

b0nny.3 builds this design. Non-negotiables it inherits:
- ship **both** DDLs + a SQLite migration runner (do not repeat the run store's inline-unversioned
  schema, audit D5);
- port `impact.mjs`/`staleness.mjs`/`gap-queries.mjs` semantics onto SQL, gated by Spike A #5 exact
  match;
- keep the graph **non-authoritative** — every node's `source_of_truth` points back to the domain
  store;
- honor the bounded edge set — no generic `related-to`;
- the outbox applier is in-process, idempotent, triggered by existing hooks/doctor — not a mandatory
  daemon.

## 13. What this document deliberately does not do

- It does **not** build the store, the applier, or the migration runner (that is b0nny.3).
- It does **not** run Spike A or report measurements (that is b0nny.5); all numbers above are
  proposed targets, explicitly not results.
- It does **not** redesign the domain stores (Work, Policy, …) — those are the E2/E3/E6 epics; this
  is the graph representation layer that indexes them.
- It does **not** choose artifact storage or database *technology beyond* the directive-mandated
  SQLite/Postgres — those §7 decisions are `construct-b0nny.4`.

## 14. Corrections found building construct-b0nny.3 (post-design, pre-merge)

Two genuine problems surfaced implementing this design against the live 16-node/16-edge-relation
corpus (not the ~35/~30 target ontology this design's §8 maps *toward* but does not itself build).
Both are fixed in the shipped code and in the companion `.sql` files; recorded here per program rule
("fix the design doc, don't silently diverge").

**14.1 — four query templates hardcoded not-yet-existing rel names.** The `impact`
(`e.rel = 'depends-on'`), `requirements` (`e.rel IN ('depends-on','consumes','implements')`),
orphaned-capability (`e.rel IN ('implements','tested-by','validates','exposes')`), and `owners`
(`e.rel = 'owned-by'`, hyphenated) templates in `graph-store/queries.sql` used §8.2's *target*
edge-relation names as literal SQL string constants. b0nny.3 ports the *existing* 16-relation
vocabulary (`imports`, `uses`, `realizes`, `validates`, `owned_by` underscored, …) onto this schema —
the ontology rename itself is out of this build's scope (§8 states the mapping; nothing in the b0nny.3
handoff, §12, asks the build to execute the rename). Against real seeded data every one of these four
queries would have silently returned zero rows forever — a query that "runs" but is quietly wrong is
worse than one that errors. Fixed by turning the hardcoded literals into bind parameters
(`:impact_rel`, `:requirement_rel_1..3`, `:coverage_rel_1..2`, `:owner_rel`) in both `queries.sql` and
`lib/graph/relational/queries.mjs`, with the latter's defaults bound to the current-vocabulary
equivalents (`imports`, `uses`/`realizes`, `owned_by`). Re-running the ontology rename later is then a
one-line default change at each call site, not a query rewrite.

**14.2 — the `cycles` query's default relation set was too permissive to run routinely.** Seeding
the `reach` CTE from *every* active node (§6, §7) and traversing a dense relation is exactly the
"whole-graph cycle scan" this design already flags as "a Spike-A latency measurement, not a routine
query" (§6 comment) — but the first implementation's chosen default rel set included `imports`, which
carries 4,276 edges on this repo's own graph (construct-b0nny.3 build-time measurement, not Spike A).
`construct graph cycles` with no `--rel` filter took long enough against the live corpus to require a
kill (no completion observed within several minutes) before the default was narrowed. Fixed by
defaulting to the small-cardinality, genuinely acyclic-by-intent relations (`embeds`, `contains`,
`requires`, `owned_by` — tens of edges each, not thousands) and lowering the default `max_depth` from
50 to 15; a caller who wants the wider, slower scan still gets it via an explicit `--rel imports`.
This is exactly the workload data Spike A's measure #4 (cycle/orphan detection latency) needs, not a
disproof of the relational approach — a targeted, correctly-scoped cycle query returns instantly
against the same corpus (verified: 0 cycles among embeds/contains/requires/owned_by on this repo's
2,323-node/6,283-edge graph, <1s).
