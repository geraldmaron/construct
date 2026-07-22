---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Graph Implementation & State-Store Audit (Wave 0)

Produced 2026-07-17 by a bounded read-only investigation agent; edited for format by the
program lead. This is the directive-required audit of the existing graph before any reuse
decision. Confidence: high on part A (agent read the core modules and live data); part B as
noted per item.

**Topology caveat:** the pre-change-intent work (`ff17508e`,
`lib/graph/change-intent.mjs`, `graph intent declare/show/list`, `.construct/graph/intents/`)
is **not** on `main` — it exists only on `feat/bead-sprint-20260717`. Confirmed by the lead
via `git merge-base --is-ancestor`. Everything below reflects `main` @ `0dcb33c3`.

## A) The dependency graph subsystem (`lib/graph/`, 17 files)

A real, populated, queryable typed dependency graph over the codebase — not a narrow
artifact.

### Model (`lib/graph/store.mjs`)

- **16 node types** (`NODE_TYPES`): file, module, workflow, capability, test, contract,
  surface, skill, rule, provider, tool, pack, doc, specialist, runtime-evidence, embed.
  Canonical id `type:key`.
- **16 edge relations** (`EDGE_RELS`): imports, realizes, validates, covers, exposes,
  governed_by, uses, embeds, co_changes, contains, requires, documents, evidenced_by,
  owned_by, reads, secures. Directed; `weight` summed on de-dup; `sources[]` provenance from
  a fixed set (registry, import-graph, co-change, override, corpus-annotation,
  runtime-evidence, embed-manifest).
- In-memory `out`/`in` adjacency maps for O(degree) traversal; primitives
  `dependenciesOf` / `dependentsOf` / `nodesByType`.

### Storage — JSONL, not SQLite

- `.construct/graph/`: `nodes.jsonl` (sorted by id), `edges.jsonl` (sorted by
  from|rel|to), `meta.json`; atomic temp-then-rename writes; deterministic/diff-clean;
  dependency-free pure JS (ADR-0001).
- **Live data:** 3,250 nodes / 8,522 edges (935 file, 804 module, 993 test, 37 capability,
  355 doc nodes; 4,459 imports, 1,926 contains, 1,517 realizes, 176 uses edges). Not a toy.
- Per-target graphs via optional `targetId` → `.construct/graph/targets/<id>/`
  (multi-project). Docstrings say `.cx/graph/` but `CONFIG_DIR_NAME = '.construct'` —
  naming drift, see part B.

### Build — full regenerate, no incremental path

- `runBuild` (`lib/graph/cli.mjs`) fans out seeders, unions results, `writeGraph`
  regenerates. One bad seeder marks the graph `partial:true` (safeStep) rather than
  crashing.
- Seeders cover **all three directive source classes**: declared
  (`build-from-registry.mjs`: capabilities.json, workflow-defs, contracts,
  provider/extension manifests, specialists/org, pack embedBindings, docs), discovered
  (`build-import-graph.mjs`: regex — not AST — import scan of lib/bin/scripts/tests;
  derives file→capability `realizes` via test import-closures; `build-co-change.mjs`: git
  history), and runtime-observed (`runtime-evidence.mjs`: `evidenced_by` from persisted
  orchestration runs; `build-from-corpus.mjs`, `build-from-embed.mjs`,
  `build-from-security.mjs`).

### Queries

- Impact: `impact.mjs` `computeImpact()` (changed files → affected tests via
  reverse-import closure + validates edges, impacted capabilities/workflows, coverage gaps,
  stale capabilities; conservative over-selection by design); `impacted.mjs`.
- Gap queries: missing-tests, missing-docs, stale, dependencies, providers, surfaces,
  owasp/security-coverage.
- Validation (`validate.mjs`): workflow→provider→tool requires-integrity, manifest disk
  presence, doc existence, capability test coverage, embed-binding integrity, dangling
  `secures`, workflow-handoff cycle check, surface parity. Solo=lenient,
  team/enterprise=strict.
- `runExplain`, node-id query.
- **Gaps vs directive:** no generic whole-graph cycle detection (only workflow handoff
  chains), no arbitrary path/shortest-path query, no explicit orphan-node query; traversal
  is JS BFS/DFS, never SQL.

### Staleness / reconciliation

- Per-source seed hashing (`staleness.mjs`): registry, overlays, specialistsOrg, plugins,
  providerManifests, workflowManifests hashed independently; `meta.json` stores
  `sourceHashes`, so drift reports *which* source moved. Second axis:
  `checkExecutionStaleness` (per-workflow days since runtime evidence, `neverExecuted`
  distinguished from aged-out).
- **Reconciliation = detect drift → full rebuild.** No diff-apply.

### Surfaces & coverage

- CLI: `construct graph <build|build-targets|stat|query|validate|impacted|owasp|missing-tests|missing-docs|stale|dependencies|providers|surfaces|explain>`;
  `construct matrix` is a deprecated alias. Note the `graph` command name also fronts the
  separate task-graph subsystem (`lib/task-graph/`) — overloaded surface.
- Hook: `lib/hooks/graph-impact-advisory.mjs` (PostToolUse on Write/Edit, non-blocking
  stderr advisory). Scripts: `run-graph-gate.mjs`, `graph-impact-shadow.mjs`; doctor
  watcher `graph-staleness.mjs`; oracle consumes via `lib/oracle/read-model.mjs`.
- **MCP surface thin:** no dedicated graph_impact/graph_query tool (only
  `lib/mcp/tools/skills.mjs` touches graph internals).
- Tests: 16 unit files under `tests/graph/` + functional `graph-target-build`,
  `graphrag-ask`. Strong.

## B) State stores & schemas

| Store | Location | Owner | Notes |
|---|---|---|---|
| Postgres relational | `lib/db/migrations/*.sql` via `lib/db/migrate.mjs` | team mode | Real migration runner (`construct_schema_migrations`); tables: orchestration_runs, queue_items+claims, workers, trace_events, shared_memory (tenant-scoped) |
| SQLite | `<stateRoot>/runtime/orchestration/runs.db` | `run-store-sqlite.mjs` (`node:sqlite`, Node≥22.5) | Schema created inline in code — **no migration files, no versioning** |
| Backend selection | `lib/storage/backend-registry.mjs` | orchestration | filesystem / sqlite / postgres |
| Vector (LanceDB) | `.construct/lancedb/observations_v1.lance` | `lib/observation-store.mjs` via `lib/storage/vector-client.mjs` | Machine-scoped (ADR-0066); embeddings engines in `lib/storage/embeddings-*.mjs` |
| Beads | `.beads/` (embeddeddolt + issues.jsonl 5.4MB + interactions.jsonl) | `lib/beads-client.mjs` | Dolt git-native sync (ADR-0026); deliberately outside state-root — travels with the repo |
| Oracle | `.construct/oracle/` (pending.jsonl, raised-issues.jsonl, verdicts/, routing/) | `lib/oracle/` | Read-model aggregates observations, outcomes, violations, doctor audit, org graph, dependency graph |
| Approval queue | `.construct/approvals/queue.jsonl` (team) / `~/.cx/approvals/queue.jsonl` (solo) | `lib/embed/approval-queue.mjs` | Full-file rewrite per transition; Postgres analog in `lib/queue/pg-queue.mjs` |
| Telemetry | `.construct/traces/<date>.jsonl` + top-level `.construct/*.jsonl` firehoses (audit-trail 3.5MB, events, contract-violations, intent-verifications, memory-stats, agent-log) | worker/trace + hooks | Team analog: Postgres trace_events |
| Assorted | `.construct/` context.json/md, stage-state, install-manifest, mcp-audit, shadow-impact + sessions/, observations/, outcomes/, runtime/, demos/, certification/ | various | — |

### Duplicate / overlapping state (flagged)

1. **Triple project-identity derivation** — self-documented by the codebase (invariant
   `cross-process-state-has-one-authoritative-location.mjs`, ADR-0092, bead
   `construct-36w10`): `deriveProjectKey` (state-root, git-remote hash),
   `projectKey` (orchestration store, config name/cwd), `resolveRootDir` (embed daemon,
   ancestor walk). They can disagree → state lands under different keys. Not converged.
2. **`.construct` vs `.cx` naming drift** — `CONFIG_DIR_NAME = '.construct'`
   (`lib/config-dir.mjs`) but docstrings and solo-mode paths still use `.cx`/`~/.cx`
   (graph store comments, approval-queue solo path, recommendation-store). Confidence
   medium on which occurrences are genuinely divergent vs aliased.
3. **Dual-schema run/trace/queue state** (filesystem-JSONL vs Postgres) — intentional
   solo-vs-team split, but the same records exist in two schemas with no shared migration
   story.

## Verdict vs the directive target

Target: relational node/typed-edge tables in SQLite/Postgres, recursive-SQL traversal,
incremental update, impact analysis, reconciliation with full rebuild.

| Target element | Status | Evidence |
|---|---|---|
| Typed node/edge model with provenance | **Exists** | store.mjs (16×16, sources[], weights) |
| Populated over the real codebase | **Exists** | 3,250 / 8,522 live |
| Impact analysis | **Exists (strong)** | impact.mjs, impacted.mjs, gap-queries, CLI + hook |
| Staleness detection | **Exists** | per-source hashes + execution staleness |
| Reconciliation | **Partial** | detect → full rebuild only, no diff-apply |
| Relational SQLite storage | **Missing** | graph is JSONL; SQLite exists only for run-store |
| Recursive-SQL traversal | **Missing** | JS adjacency BFS/DFS only |
| Incremental update | **Missing** | every build is full regenerate |
| Generic cycle/orphan/path queries | **Missing** | workflow-chain cycle check only |

**Bottom line:** roughly **60–70% of the substrate exists and is genuinely good** [source: auditing agent's estimate over the status table above — 5 of 9 target elements exist or are partial] — typed,
directed, provenance-tracked, multi-source, impact-capable, tested. The build is the
implementation shape: SQLite node/edge tables, recursive-CTE traversal, incremental update,
diff-based reconciliation, plus the missing generic queries. The impact-analysis logic is
portable onto a SQL store with minimal semantic change.
