---
intake: none
---

# Spike A — Graph Foundation Validation (construct-b0nny.5.1)

Disposable validation spike, directive §11 Spike A. Harness script and raw output live in
[`spikes/a-graph-foundation/`](../spikes/a-graph-foundation/) (`run-spike.mjs`, `results.json`).
This is independent measurement of the relational graph store construct-b0nny.3 already built
(`lib/graph/relational/`, wired into `lib/graph/store.mjs`), pinned by
`tests/functional/graph-relational-store.functional.test.mjs`'s 12 day-one milestones. Nothing
here re-implements or re-validates those 12 milestones — it measures real behavior against real
data the way an external evaluator would, per directive §4/§11's list: build time, incremental
update time, query latency, impact correctness, reconciliation, cycle/orphan detection, storage
footprint, migration burden, dependency count, cross-platform behavior.

**Repo state at measurement time:** HEAD `712fbcd6` on `feat/workspace-control-plane`, run at
`2026-07-18T00:48Z`, Node v25.9.0.

## Methodology

Real repo, sandboxed state. Every CLI invocation ran with `cwd` set to this repo's own root
(`REPO_ROOT`) so the graph seeders scan this repo's real content and produce a real,
representative graph — not a synthetic toy. Every invocation also set `CX_HOME_OVERRIDE` to a
freshly created `mkdtemp` directory (`lib/paths.mjs` `homeDir()` honors this override
unconditionally, ahead of `os.homedir()`), so all `graph.db` / JSONL state landed under a
disposable sandbox, never under the real `~/.construct/`. This mirrors the isolation pattern the
existing functional test already established, applied to the real repo as the data source
instead of an empty tmp project.

Two sandbox roles: a **read sandbox** (cold build once, then every read-only measurement —
query latency, impact correctness — against that one real build, never mutated) and a
**mutation sandbox** (a second, independent build, used only for incremental update, cycle
injection, orphan injection, and reconciliation-drift experiments) — so intentionally-introduced
synthetic drift never contaminates the real-data query measurements.

This repo's own graph (2,371–3,129 nodes / 6,304–8,132 edges depending on whether `--no-co-change`
is passed) was used directly as the corpus rather than a synthetic graph — real and large enough
to show real scaling behavior, as the two dense-traversal findings below demonstrate.

Reproduce: `node docs/notes/research/workspace-control-plane/spikes/a-graph-foundation/run-spike.mjs`
from the repo root. All numbers below are from `results.json` (or from an isolated probe command
shown inline) produced by that run.

**Failure mode discovered mid-run, now part of the harness itself:** the first two attempts at
this script hung — once for 4+ minutes, once for 90+ seconds — because two of the store's
recursive-CTE query functions (`queryDown`, `queryPath`) have no rel-type filter and a default
`maxDepth` of 50, and this repo's own import graph is dense enough to make that combination
non-terminating in practice. Every recursive-query probe in the final harness runs in its own
child process with a hard `SIGKILL` timeout so a hang reports as data (`timedOut: true`) instead
of stalling the harness — this is itself the single most load-bearing finding of the spike (see
"Query latency" below).

## Build time (cold + incremental rebuild)

Commands: `construct graph build --no-co-change --json` (cold, fresh sandbox) → `construct graph
build --json` (same DB, now WITH co-change git-history scan) → `construct graph build
--no-co-change --json` again (warm DB, no co-change).

| Run | Wall time | Nodes | Edges |
|---|---|---|---|
| Cold build, `--no-co-change` | 423.5ms | 2,371 | 6,304 |
| Rebuild WITH co-change (adds directory/module nodes + `co_changes` edges from `git log` over 1,316 commits) | 654.0ms | 3,129 | 8,132 |
| Warm rebuild, `--no-co-change` (DB already exists) | 426.7ms | 2,371 | 6,304 |

Co-change analysis over the repo's full 1,316-commit history adds only ~230ms — cheap relative to
the base build, not the bottleneck some might expect from a full `git log` walk.

## Incremental update time

Command: enqueue one `node_upsert` + one `edge_upsert` via `enqueueOutboxEvent` (in-process), then
`construct graph update --json`, repeated 10 times against a freshly built mutation-sandbox graph
(2,371 nodes / 6,304 edges).

- 10 runs, each applying exactly 1 delta, 0 failed, 0 dead-lettered: mean **220.7ms**, p95
  **238.3ms**, min **212.5ms** (CLI round-trip, includes Node process startup).
- No-op drain (nothing pending): **216.0ms**, `trustIncremental: true`.
- Post-update query of the last inserted node: found, confirming the delta is live and queryable,
  not just recorded as applied.

The ~215ms floor is process-startup dominated (a bare `node bin/construct` invocation costs
roughly that much regardless of subcommand — see the query latency CLI numbers below, which show
the same floor). The actual outbox-drain work itself is fast; incremental update cost here is
"how expensive is invoking the CLI once," not "how expensive is applying one delta."

## Query latency

Hub node used throughout: `file:lib/config-dir.mjs` (imported by 148 other files per a static
grep — a genuine hub, not cherry-picked for a good result).

**CLI round-trip, `construct graph query <id> --json` (the command real callers actually use)** —
this performs a single-hop lookup via in-memory adjacency maps (`lib/graph/store.mjs`
`dependenciesOf`/`dependentsOf`), not a recursive traversal:
- 20 runs: mean **143.7ms**, p50 **143.8ms**, p95 **147.3ms**, min **140.8ms** — dominated by
  Node process startup + full graph load into memory, not by the lookup itself.

**In-process `queryUp` (transitive "what this node depends on," default `maxDepth=50`)** — 50
calls, all bounded because this node's own dependency closure is small and terminates:
mean **68.3ms**, p95 **69.5ms**.

**In-process `queryDown` (transitive "what depends on this node," no rel filter, default
`maxDepth=50`) — the load-bearing negative finding of this spike.** `QUERY_DOWN` has no rel
parameter (unlike `QUERY_CYCLES`/`QUERY_IMPACT`, which do), so it always traverses every edge
type, including `imports` (4,297 of this graph's 8,132 edges — 52.8%[^1] — and known to contain
cycles in a real codebase, per `queries.mjs`'s own header comment). Depth-by-depth, each run in
its own hard-killed child process:

| maxDepth | Result |
|---|---|
| 1 | 71.3ms, 154 rows |
| 2 | 493.1ms, 656 rows |
| 3 | 2,037.6ms, 921 rows |
| 5 | **TIMED OUT / SIGKILL after 12,000ms** |
| 8 | **TIMED OUT / SIGKILL after 12,000ms** |

Growth is not linear (71ms → 493ms → 2,038ms is already ~7x then ~4x per step) and the function
does not return at all past depth 4. The CLI's default `maxDepth` for any caller that did wire
this up would be **50** — i.e., a real caller would hang, not "run slow." This exactly reproduces,
at this repo's current larger size, a hang `queries.mjs`'s own header comment already documents
for `queryCycles` with the `imports` rel at a smaller prior graph size (2.3k nodes/6.3k edges,
"caused a real multi-minute hang" during construct-b0nny.3 development) — independently
reconfirmed here rather than taken on faith: a direct re-run of `queryCycles(rels: ['imports'],
maxDepth: 15)` against the current graph also **timed out after 30,000ms**.

**Consequence worth naming plainly:** `queryUp`/`queryDown` are exported from `queries.mjs` but
are not called from any CLI subcommand or any other `lib/` module today (checked via grep across
`lib/graph/cli.mjs` and all of `lib/graph/relational/`) — the directive §4.8 "query
up/downstream" milestone capability exists as a function but has no exposed command surface yet,
and the one command that does exist (`construct graph query`) avoids the hang only because it
takes a different, single-hop code path, not because the underlying recursive query is safe.

**`queryPath` (real path, `file:bin/construct` → `file:lib/graph/store.mjs`)** — same
no-rel-filter, default-`maxDepth=50` shape as `queryDown`; the first in-process attempt at the
default depth also hung (part of the same discovery above). Bounded to `maxDepth=3`: found in
**4,301.6ms**, depth 2, chain verified. 4.3 seconds for a real, shallow (2-hop), grep-confirmed
path is high for a lookup a change-impact gate would need to run routinely — the cost is the
recursive CTE's per-row `LIKE`-based cycle guard over the same dense edge set, not the path length
itself.

**`queryCycles` (default rels: `embeds`/`contains`/`requires`/`owned_by` — the ones the code
deliberately keeps away from `imports`):** 65.1ms, 0 cycle members on the real graph as it stands
today (no such cycles currently exist in this codebase by those rel types).

**`queryOrphans` (whole-graph, no filter):** 18.2ms, 486 orphans found (nodes with zero edges of
any kind) — fast; a simple `NOT EXISTS` query, no recursion involved.

## Storage footprint

`graph.db` after the co-change build (3,129 nodes / 8,132 edges): **5,611,520 bytes (5.35 MiB)**.
The legacy JSONL snapshot the same build also writes for diff-clean review
(`.construct/graph/{nodes,edges}.jsonl`): **1,319,427 bytes (1.26 MiB)**. The SQLite file is
~4.25x the JSONL snapshot's size for the identical data — expected (schema/index overhead, WAL
journal), not concerning at this scale (low single-digit MiB either way).

Caveat: every `construct graph build`/`update`/`reconcile` CLI call also refreshes
`REPO_ROOT/.construct/graph/*.jsonl` regardless of `CX_HOME_OVERRIDE` — that export path is keyed
by the project's `cwd`, not by the machine-scoped state root the sandbox isolation covers. This
is a pre-existing, gitignored (`.construct/**` per `.gitignore`), non-committed derived artifact;
running this harness repeatedly left it reflecting the harness's last build, not a pre-spike
baseline. It has no bearing on git state (`git status` confirms `.construct/` is untracked).

## Impact correctness

Independent oracle, not the seeder under test: wrote a from-scratch forward-import-graph scanner
(own file walk, own regex, own specifier resolver — deliberately not importing
`lib/graph/build-import-graph.mjs`, so a bug shared between seeder and checker cannot hide),
reverse-BFS'd it per candidate, and diffed the result set against `queryImpact(rootDir, changedId,
{ impactRel: 'imports', nodeType: 'test' })`.

| Changed node | Oracle test count | Store test count | Match |
|---|---|---|---|
| `file:lib/graph/normalize.mjs` | 72 | 72 | **exact match**, 0 missing / 0 extra, 2,378.8ms |
| `file:lib/graph/relational/schema-version.mjs` | 72 | 72 | **exact match**, 0 missing / 0 extra, 1,681.5ms |
| `file:lib/config-dir.mjs` (148-importer hub) | 550 | — | **TIMED OUT / SIGKILL after 20,000ms** — store side never returned |

Two of three candidates matched an independently-computed oracle exactly — genuine positive
evidence that the impact traversal is correct where it terminates. The third — the same hub node
used for the query-latency probes above — hit the identical dense-traversal wall: `queryImpact`
restricts to one rel (`imports`, unlike `queryDown`) but shares the same uncapped `maxDepth=50`,
and on a 148-importer hub with a 52.8%-dense[^1] `imports` relation it did not return inside 20
seconds. Impact correctness is **verified for ordinary nodes, unverified (not merely
"unmeasured" — actually timed out) for hub-scale nodes**, which is precisely the case directive
§4's change-impact gate most needs to be reliable for.

## Reconciliation

Introduced a `capability:spikeA-manual-only` node via `enqueueOutboxEvent` with `declared: false`
(no backing seeder — mirrors the existing functional test's milestone 12 approach), on a mutation
sandbox that by this point also carried 10 synthetic `declared: true` nodes from the incremental-
update phase, 2 synthetic cycle nodes, and 1 synthetic orphan node from the phases below — none of
which any real seeder produces.

- `construct graph reconcile --no-co-change --json`: `empty: false`, `applied: true`, in
  **435.4ms**.
- Diff reported: **nodes +0/−14/~0, edges +0/−2/~0** — exactly the 14 synthetic nodes (1 manual-
  only + 10 incremental + 2 cycle + 1 orphan) and 2 synthetic edges (the injected cycle) introduced
  across the whole run, all correctly identified as drift and removed in one pass.
- Post-reconcile query of the manual-only node: **not found** (removal actually applied, not just
  reported).
- Second reconcile immediately after: `empty: true` in **348.0ms** — confirms the repair actually
  converged rather than reconcile re-reporting the same drift.

Worth noting explicitly: reconcile removed the `declared: true` synthetic nodes too, not just the
`declared: false` one. `declared` is provenance metadata on the outbox event, not a protection
flag against reconciliation — anything a fresh seeder pass doesn't reproduce is drift, regardless
of how it was declared. This matches the store's documented design (reconcile diffs live state
against "the same seeders `build` runs") but is easy to assume otherwise from the milestone
test's naming, so it is recorded here as a real, observed behavior rather than an inference.

## Cycle / orphan detection

**Cycle:** introduced a genuine 2-node cycle (`capability:spikeA-cycle-a` ↔
`workflow:spikeA-cycle-b` via two `embeds` edges, one each direction), ran `graph update`, then
`graph cycles --json`: **detected = true**, exactly 2 cycle members reported, no false positives
among the mutation sandbox's other 6,304+ edges.

**Orphan:** introduced a genuine orphan capability (no `realizes`/`validates` inbound edges), ran
`graph update`, then `graph orphans --capabilities --json`: **detected = true**, present among 12
total orphaned capabilities reported for that sandbox's build.

Both are real detections on real (if synthetic-for-the-test) data, not assertions against a
canned fixture.

## Migration burden

Single commit: `0acfe27c` — "feat(graph): build relational graph store foundation with day-one
milestone proof (construct-b0nny.3)". `git show --stat 0acfe27c`:

```
42 files changed, 2773 insertions(+), 137 deletions(-)
```

Net-new surface: `lib/graph/relational/` (11 files — sqlite-db, sqlite-store, postgres-store,
queries, outbox, reconcile, schema-version, workspace, export, migrate-sqlite, plus the
`migrations/` SQL), one migration file (`lib/db/migrations/007_graph_foundation.sql`, 108 lines),
`lib/graph/cli.mjs` (+236 lines for the new subcommands), `lib/graph/store.mjs` (rewritten
resolver, net −0 lines: 138 changed), plus 316 lines of the functional test and several dozen
lines of existing per-command unit test updates. Not a rewrite of the surrounding system — the
137 deleted lines are almost entirely inside `store.mjs`'s own resolver rewrite.

## Dependency count

**Zero new runtime dependencies added by this work.** `git show 0acfe27c -- package.json` is
empty — no `package.json` change in the migration commit. The Postgres client
(`postgres@^3.4.9`, currently an `optionalDependency`) was already present in `package.json`
before construct-b0nny.3, added in an earlier commit (`7b6f4615`, "feat(lmcp): wire storage
manifests and postgres db scaffold"), confirmed via `git log --oneline -S'"postgres"' --
package.json`. `node:sqlite` is a Node.js builtin (Node ≥22.5), not an npm package — zero
footprint in `package.json`, `package-lock.json`, or `node_modules`.

## Cross-platform behavior

**Node ≥22.5 (this environment):** `sqliteAvailable()` → `true` on the running Node v25.9.0.
Confirmed only two Node runtimes exist in this environment — `v22.23.1` (fnm-managed) and
`v25.9.0` (system, `which -a node`, `fnm list`) — both satisfy `>=22.5`. **No Node <22.5 binary
was available to actually spawn in this environment**; a live old-runtime run could not be
performed, and this report does not claim one was.

**JSONL fallback code path, exercised as far as honestly possible without an old runtime:**
`lib/graph/store.mjs`'s `writeGraph`/`loadGraph` take the JSONL path whenever `targetId ||
!sqliteAvailable()` — the `targetId` branch reaches the *identical* `writeGraphJsonl`/
`loadGraphJsonl` functions a Node <22.5 host graph would use, regardless of `sqliteAvailable()`'s
value. Calling `writeGraph(rootDir, testGraph, { targetId: 'spikeA-fallback-probe' })` then
`loadGraph(rootDir, { targetId: ... })`: wrote 1 node, loaded it back correctly
(`found: true`), and confirmed `nodes.jsonl`/`edges.jsonl`/`meta.json` were actually written to
disk. This is real evidence that the fallback functions work, but it is **not** a live run under
an actual Node <22.5 process, and the two facts should not be conflated — flagged here explicitly
rather than left implicit.

**Postgres:** not attempted live. `docker` is installed in this environment but the daemon is not
running (`docker info` fails), and `DATABASE_URL` is unset — matching
`tests/graph/relational-postgres-store.test.mjs`'s own documented skip condition exactly, not a
new gap introduced by this spike. Starting Docker Desktop to stand up a throwaway Postgres was
judged out of scope for a disposable spike and was not attempted. `PostgresGraphStore` therefore
remains **structural-only** in this environment: `bindNamedParams`'s `:name → $n` rewrite is pure
JS and was not independently re-verified here (already unit-tested in the existing suite), but no
live `writeGraph`/`loadGraph` round-trip against a real Postgres instance was run by this spike,
same as the existing test suite's own status.

## Go/No-Go verdict

**Conditional GO** — adopt the relational SQLite substrate as the graph foundation, with one
blocking follow-up required before the multi-hop traversal surface is wired to any user-facing
command or relied on for directive §4's change-impact gate.

**What is solid, with real numbers behind it:**
- Build (423–654ms), incremental update (mean 221ms round-trip, 0 failures across 10 runs),
  1-hop query (mean 144ms CLI round-trip), reconciliation (435ms, correctly detects and repairs
  14 synthetic drifted nodes + 2 edges, converges to `empty: true` on re-run), cycle detection
  (2/2 correct on a real injected cycle), and orphan detection (1/1 correct on a real injected
  orphan) are all fast, all correct against ground truth I constructed and could hand-verify, and
  all exercised through the real CLI, not mocked.
- Impact correctness matched an independently-written oracle exactly for 2 of 3 real test cases.
- Migration cost was one commit, 42 files, net ~2,600 lines, zero new dependencies — a low,
  well-bounded cost for what was added, consistent with the sustainability constraints in
  directive §13.

**What blocks unconditional adoption:** `queryDown`, `queryPath`, and `queryImpact`-on-hub-nodes
share one uncapped, no-rel-filter recursive-CTE shape that goes from "slow" (2 seconds at depth 3)
to "does not return" (12–30 second hard kills at depth 5+, and on a real 148-importer hub even at
the impact query's default depth) on this repo's own real, moderately-dense import graph
(52.8%[^1] of edges are `imports`). This is not a hypothetical edge case: it reproduces, at larger
scale, a hang the implementers' own code comments already documented for a sibling query
(`queryCycles` + `imports`) during construct-b0nny.3 development, and it is currently only
avoided in practice because the one CLI command that exists (`construct graph query`) happens to
take a different, single-hop code path — not because anyone fixed the recursive query. The
directive §4.8 "query up/downstream" capability and the §4 change-impact gate (which explicitly
must not let "a change ... be complete while required dependents are unevaluated") both depend on
exactly the traversal that currently hangs on real hub nodes in this repo's own graph.

**Required before this surface ships behind any command or gate:** add a rel-type filter
parameter to `QUERY_DOWN`/`QUERY_PATH` matching the pattern `QUERY_CYCLES`/`QUERY_IMPACT` already
use, default it away from dense rels the way `DEFAULT_CYCLE_RELS` already excludes `imports`, and
add a regression test that pins a maximum latency for a real hub node in this repo's own graph
(e.g., "`queryDown`/`queryImpact` on the most-imported file must return within N seconds") so this
class of regression cannot silently reappear as the repo grows. Until that lands, any caller of
these three functions on a hub-scale node should assume it may not return.

**Not evaluated / explicitly out of scope for this verdict:** Postgres backend correctness (no
live instance reachable, matches existing test suite's documented posture, not attempted here);
genuine Node <22.5 runtime behavior (no such binary existed to spawn in this environment — the
JSONL fallback functions were exercised via an equivalent code path, not the actual old-runtime
path).

## Evidence trail

- [`spikes/a-graph-foundation/run-spike.mjs`](../spikes/a-graph-foundation/run-spike.mjs) — the
  harness; every number above traces to a phase function in this file.
- [`spikes/a-graph-foundation/results.json`](../spikes/a-graph-foundation/results.json) — raw
  output of the run this report is drawn from.
- `lib/graph/relational/queries.mjs` — `QUERY_UP`/`QUERY_DOWN`/`QUERY_PATH`/`QUERY_CYCLES`/
  `QUERY_IMPACT` definitions and the header comment independently reconfirmed above.
- `lib/graph/relational/{sqlite-db,sqlite-store,outbox,reconcile,postgres-store}.mjs`,
  `lib/graph/store.mjs`, `lib/graph/cli.mjs` — store/CLI surface exercised.
- `tests/functional/graph-relational-store.functional.test.mjs`,
  `tests/graph/relational-postgres-store.test.mjs` — the existing milestone/Postgres tests this
  spike deliberately did not re-implement, cross-referenced for the Postgres skip-condition claim.
- `git show --stat 0acfe27c`, `git log --oneline -S'"postgres"' -- package.json` — migration
  burden and dependency count evidence.
- `fnm list`, `which -a node`, `docker info` — cross-platform/Postgres environment checks.

[^1]: 4,297 `imports` edges of 8,132 total edges, from the co-change build in the "Build time"
  table above (`construct graph build --json`, WITH co-change) — a separate, larger build than
  `results.json`'s `coldBuildAndStorage.edgeCount` field, which only persisted the
  `--no-co-change` numbers. Reproduced in an isolated `CX_HOME_OVERRIDE` sandbox while writing
  this footnote: 3,131 nodes / 8,132 edges / 4,297 `imports` — an exact match on edges, 2 nodes
  of drift from ordinary repo changes since the spike ran.
