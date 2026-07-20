---
intake: none
---

# Spike E — Recovery Validation (`construct-b0nny.5.5`)

Verified in this worktree (`.claude/worktrees/workspace-control-plane`, branch
`feat/workspace-control-plane` @ `712fbcd6`), disposable per directive §11 spike E. All
harness code and evidence live under
[spikes/e-recovery/](../spikes/e-recovery/) and are excluded from production paths
(`lib/`, `bin/`, `specialists/`, `rules/`, `skills/`, `templates/`) unless a later bead
adopts them. Nothing was committed or pushed.

## Verdict

**Go, with one documented gap.** 15 of 16 scenarios passed outright; 163 of 164 individual
checks passed. The one failing check is a real, understood, non-catastrophic finding — edge
weight inflates (not a duplicate row, not data loss, not a stuck workflow) when a
`graph_update` stage's crash-forced redo re-declares the same edge — not a masked test-harness
bug. The core recovery properties the target hypothesis's day-one graph gate depends on
(idempotent resume, safe cleanup, node-level graph consistency) held at all 7 interruption
points, using a real relational graph store (`lib/graph/relational/`, `construct-b0nny.3`),
real `SIGKILL` process termination, and real filesystem/SQLite state inspection — no narrated
"assume this passes" steps anywhere in the matrix. The one gap has a one-line fix recommended
below and should be a required follow-up before any production workflow engine copies this
stage shape for `graph_update`.

## What was built

A real, resumable, 7-stage workflow harness — not a mock — under
[spikes/e-recovery/](../spikes/e-recovery/):

- **[harness.mjs](../spikes/e-recovery/harness.mjs)** — the workflow itself: dispatch →
  execution → artifact production → approval → external write (simulated, real file I/O,
  never a real network call) → integration → graph update. Runs as its own OS process
  (`node harness.mjs --run-dir <dir> --run-id <id> [--crash-at <point>]`) so a crash is a
  genuine `SIGKILL` delivered by the OS, not a caught exception — `SIGKILL` cannot be
  intercepted, so nothing in the process gets a chance to clean up, exactly the failure mode
  real recovery has to survive.
- **[lib/state-io.mjs](../spikes/e-recovery/lib/state-io.mjs)** — durable checkpoint
  primitives. Every write to `state.json` goes through `writeJsonAtomic` (temp file same
  directory, `fsync`, `rename`), so a kill mid-write can only ever leave the last fully
  committed checkpoint in place, never a truncated/unparseable one.
- **[lib/graph-adapter.mjs](../spikes/e-recovery/lib/graph-adapter.mjs)** — thin wrapper over
  the real `lib/graph/relational/` store built in `construct-b0nny.3`: `graph_update` uses
  `enqueueOutboxEvent` + `drainOutbox`, the identical code path `construct graph update` runs.
  Reconciliation uses `reconcileGraph` — the same function `construct graph reconcile` calls —
  diffed against the workflow's own declared node/edge set (a full rebuild-from-repo-source
  fresh seed isn't meaningful against a synthetic sandbox with no real repository to scan; see
  Limitations).
- **[run-matrix.mjs](../spikes/e-recovery/run-matrix.mjs)** — the driver. Spawns `harness.mjs`
  as a child process per scenario, lets it self-`SIGKILL` at the requested point, resumes it,
  supplies whatever out-of-band fixture a property needs (approval grant, spec/plan edit,
  artifact drift, cancel flag, objective supersession), and asserts against real
  filesystem/state/SQLite evidence. Every scenario gets its own scratch triple (run dir,
  `CX_HOME_OVERRIDE` home, graph project dir) under a fresh `mkdtemp` root, following the exact
  isolation pattern `tests/functional/graph-relational-store.functional.test.mjs` already
  established, so graph state never crosses scenarios and never touches this repo's real
  `.construct/graph`.

Isolation was verified directly: after a full matrix run, `~/.construct/projects` on the real
machine had no directory newer than the run (checked with `find ... -newer -mmin -5`); all
graph state lived under scratch `CX_HOME_OVERRIDE` homes that were removed after each run.

### Why a self-inflicted `SIGKILL` counts as a real crash

`harness.mjs` decides internally, from the `--crash-at` argument, exactly when to call
`process.kill(process.pid, 'SIGKILL')`. This is still a real crash proof, not a narrated one:
`SIGKILL` is delivered by the kernel and cannot be caught, blocked, or handled — the process
dies with zero opportunity to run cleanup code, flush buffers it hasn't already flushed, or
finish a write in progress. The evidence is the OS-reported exit signal
(`spawnSync(...).signal === 'SIGKILL'`), checked in every one of the 7 core scenarios (see
`crash-was-a-real-kill` / equivalent in each `results/core-*.json`). The alternative — an
external driver polling a marker file and timing a kill from outside — was considered and
rejected: it is racy (poll interval vs. actual crash-point timing) where the in-process
self-kill is deterministic and exactly reproducible on every run, without changing what the
kill signal itself proves.

### Two-phase stage design (the mechanism that makes "during X" tests possible)

`execution`, `external_write`, and `graph_update` do their real side-effecting work — the
deterministic transform, the upsert into the simulated external record store, the outbox
enqueue+drain into SQLite — **before** the crash check, and only mark the stage `complete`
**after** it. A crash at `during_<stage>` therefore always lands after the real effect already
committed once but before the stage is durably marked done. Because `state.stages.<stage>`
is still `'pending'` after such a crash, resume re-enters the *entire* stage function from
scratch — performing the real effect a second time for real, not a simulated "as if it ran
twice." This is what turns the crash-resume test for these three stages into a genuine,
non-narrated idempotency proof rather than a no-op it never actually exercised.

### Test-orchestration flag: `--stop-after-stage`

Three property tests (spec changed mid-flight, plan changed mid-flight, artifact drifted
after approval-before-integration) need a mutation to land at an exact stage boundary that has
no natural pause. `harness.mjs` accepts `--stop-after-stage <name>`, which exits cleanly (not a
crash — no `SIGKILL`, no forced re-entry) right after that stage reaches `complete`, so
`run-matrix.mjs` can inject the mutation and then resume normally. This is explicitly
test-scaffolding, documented as such in the harness's own header comment, and never appears in
the interruption matrix itself.

## Interruption × property matrix

Per the task's own pragmatic-scope guidance: all 7 points were run for the three
load-bearing, universally-applicable properties (idempotent resume, safe cleanup, graph
reconciliation). The remaining six properties were each tested at 1–2 points where the point
makes the property mechanically meaningful, rather than forced across all 7 — a stale-approval
check at `during_execution`, for example, has nothing to reject (no approval has been granted
yet at that point).

| Property | before_dispatch | during_execution | after_artifact_production | before_approval | during_external_write | before_integration | during_graph_update |
|---|---|---|---|---|---|---|---|
| Idempotent resume (no repeat of accepted work) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safe cleanup (no orphaned state) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Graph reconciliation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ nodes ✅ / edges ✗ |
| Idempotent effects (double-execution) | — | ✅ | ✅ (artifact recompute) | — | ✅ | — | ⚠️ (see finding) |
| Stale-approval handling | — | — | — | ✅ | — | ✅ | — |
| Expired-credential handling | — | — | — | — | ✅ | — | — |
| Changed spec/plan mid-flight | — | ✅ (spec) | — | ✅ (plan) | — | — | — |
| Cancellation | ✅ | — | ✅ | — | — | — | — |
| Supersession | ✅* | ✅* | — | ✅* | — | — | — |

\* Supersession is checked at stage *boundaries* only (`before_execution` and
`before_approval` boundaries — see Limitations), not preemptively mid-stage; the
`before_dispatch` column reflects that a run must complete `dispatch` before it can even be
superseded (dispatch is the stage that claims the objective lock).

16 scenario runs in total (7 core + 2 stale-approval + 1 expired-credential + 2 changed-spec/
plan + 2 cancellation + 2 supersession), 164 individual checks, reproduced twice with identical
results. Full per-scenario evidence: [spikes/e-recovery/results/](../spikes/e-recovery/results/)
(`summary.json`/`summary.txt` for the rollup, one `<scenario-id>.json` per scenario with the
complete check list, history log, and captured state/graph snapshots).

## Evidence by property

**Idempotent resume.** For every one of the 7 core scenarios, every stage-completion history
event (`dispatch-complete`, `execution-complete`, `artifact-content-written`,
`approval-requested`, `approval-complete`, `external-write-complete`, `integration-applied`,
`graph-update-complete`) fires **exactly once** across the crashed + resumed run — with one
understood, explicitly-checked exception: at `after_artifact_production`, the crash lands
*inside* the artifact stage before its own completion checkpoint, so `artifact-content-written`
fires twice (`core-after_artifact_production.json` → `historyEventCounts.artifact-content-
written: 2`) — and the recomputed hash is checked identical both times (`idempotent-effect-
artifact-recompute-same-hash`), proving the redo is a safe recomputation, not a divergent
second artifact.

**Safe cleanup.** `no-orphaned-tmp-files` passed for all 7 core scenarios plus both
cancellation scenarios and both supersession scenarios (`listOrphanTmpFiles` on `tmp/` after
the run reaches a terminal state) — every phase marker and working file the crashed attempt
left behind was removed once the run legitimately concluded (`done`, `cancelled`, or
`superseded`).

**Idempotent effects.** `during_external_write`: the crashed attempt performed one real
read-modify-write of `external/records.json`; resume performed a second, real one. End state
(`core-during_external_write.json` → `evidence.externalRecords`):
```json
{"run-core-during_external_write": {"status": "WRITTEN", "artifactHash": "1773f3b4…", "applyCount": 2}}
```
One record, `applyCount: 2` — proof it ran twice, not that it left two records. `during_
graph_update`: the outbox shows `applied: 6` (two full 3-event drains of the identical
work/artifact/edge delta) yet the node table shows zero drift (see next paragraph) —
`upsertNode`'s last-write-wins semantics make a repeated identical node upsert a true no-op.

**Graph reconciliation — the one real failure.** `graph-nodes-reconciled` passed in all 7 core
scenarios: `reconcileGraph`'s node diff against the workflow's own declared seed was always
`{added: [], removed: [], changed: []}`. `graph-edges-reconciled` failed in exactly one
scenario, `core-during_graph_update`:
```json
"edges": {"added": [], "removed": [], "changed": ["work:obj-core-during_graph_update|produces|artifact:run-core-during_graph_update"]}
```
Root cause, traced to `lib/graph/normalize.mjs` (by design, not a bug in that module):
`upsertEdge`/`normalizeEdges` **sum weight and union sources** on repeated upsert of the same
edge — deliberately, so repeated evidence for a relationship strengthens confidence. A
`graph_update` stage whose crash-forced redo re-declares the identical edge therefore leaves
that edge's weight doubled (2 instead of 1) relative to a single-declaration fresh seed. This
is not data corruption, not a duplicate row (edges are keyed by `from|rel|to`, so there is
still exactly one edge), and not a stuck workflow — but it **is** a real idempotency gap: a
`graph_update` stage that retries after a crash (or, worse, after several) inflates edge
weight on every redo, unbounded by anything in this stage's own design. `computeTrustDecision`
still reported `trustIncremental: true` throughout, because that function checks outbox
drain/dead-letter/schema-version/contested-node health, not edge-weight drift against a
fresh-seed baseline — so a production system relying only on the trust decision (as
`construct graph update --json` does) would not surface this on its own; only the
reconcile-against-fresh-seed comparison this spike ran caught it.

**Recommended fix** (not applied here — out of scope for a disposable spike): a `graph_update`
stage should declare its outbox events with an idempotency/occurrence key (e.g., "this edge was
observed by run X" rather than "add one more count of evidence"), or the stage should check
whether it already durably recorded this exact delta before re-enqueueing on redo — the second
option is simpler and requires no schema change: persist a small `graphDeltaApplied: true` flag
in `state.json` once `applyGraphDelta` first succeeds, and skip re-enqueueing on any later
re-entry of the stage, exactly the same "durable idempotency flag" pattern
`external_write`'s upsert-by-`recordId` already gives that stage implicitly and `graph_update`
does not.

**Stale-approval handling.** `before_approval`: artifact drifted after a valid grant was
issued; the approval stage rejected it (`stages.approval: 'rejected_stale'`), invalidated the
grant file (renamed to `grant.rejected-stale.json`, `grant.json` no longer present so nothing
can accidentally re-consume it), performed no external write, and recovered cleanly once a
fresh grant was issued against the new hash. `before_integration`: approval was validly
granted and consumed, external write ran, then the artifact drifted; integration (not
approval) caught the mismatch on its own separate check and blocked
(`stages.integration: 'blocked_stale_approval'`) without writing to `integrated/knowledge.md`.

**Expired-credential handling.** A credential born already-expired (`credentialTtlMs: -60000`)
caused `external_write` to block with `blocked_credential_expired` and perform zero writes
(`external/records.json` never created) — the correct failure mode the task asked to prove.
Credential *refresh*-and-resume was not modeled (see Limitations).

**Changed source/spec/plan mid-flight.** Spec mutated between dispatch and execution: execution
recomputed the spec hash, found a mismatch against the hash captured at dispatch, and blocked
(`blocked_spec_changed`) without producing an artifact from stale input. Plan mutated after
artifact production, before approval: approval's plan-hash check caught it and blocked
(`blocked_plan_changed`) without granting on a stale plan.

**Cancellation.** `before_dispatch`: a cancel flag present before the first invocation stopped
the run with every stage still `pending` (nothing ran). `after_artifact_production`: a cancel
flag written mid-flight stopped the run with `dispatch`/`execution`/`artifact` left `complete`
(not rolled back — cancellation stops forward progress, it does not undo accepted work) and no
external write or integration ever occurred.

**Supersession.** Two independent run directories sharing one objective lock file: Run A
dispatches first and claims the lock; Run B (the newer request) dispatches for the same
objective and overwrites it; Run A's next stage-boundary check sees a lock naming a different
holder and stops with `status: 'superseded'`, its stage progress frozen exactly where it was
(verified byte-for-byte against the pre-supersession snapshot); Run B proceeds to `done`
normally. Tested at the `dispatch→execution` and `artifact→approval` boundaries.

## A real bug this spike found and fixed in the harness itself

Mid-build, `resumeUntilDone` (the driver's resume loop) stalled with zero further invocations
after a crash inside `external_write`/`integration`/`graph_update`, because `harness.mjs`
never reset the durable `status` field to `'running'` on a fresh invocation — a stale
`'blocked'` from an earlier, already-resolved pause (e.g. `awaiting_approval`) persisted in
`state.json` and made the driver believe the run was still stuck on a condition that no longer
applied. Fixed by resetting `state.status = 'running'` at the top of every invocation, before
the stage loop re-derives the real status from what actually happens that attempt (see the
comment at `harness.mjs`'s `main()`, just after `loadState`). Recorded here per the instruction
to report findings honestly — this was a genuine defect in the recovery logic itself, caught
only because the driver's assertions (not narration) refused to report `run-reached-done` as
true when it wasn't.

## Limitations — what was not tested, and why

- **Cancellation and supersession are checked at stage boundaries only**, not preemptible
  mid-stage. A stage already in flight when a cancel/supersede signal arrives runs to its own
  completion (or crash) before the next boundary check notices. This mirrors the harness's
  actual granularity honestly rather than claiming a preemption capability that was not built.
- **Credential refresh-and-resume was not modeled.** The expired-credential scenario proves
  detection and the correct block, not "resumes automatically once a fresh token is supplied,"
  because the harness has no credential-refresh input channel — out of scope for what the task
  asked ("show the correct failure mode").
- **Graph reconciliation diffs against the workflow's own declared seed, not a full
  rebuild-from-repository-source fresh seed.** `construct graph reconcile` in production
  scans real repo source (manifests, imports, etc.); this spike's graph nodes are synthetic
  workflow artifacts with no corresponding source files to scan, so a real
  `assembleHostGraph`-based reconcile would always show "removed" (nothing in the spike
  sandbox is discoverable by the real scanners) — a false signal, not a true one. Reconciling
  against the workflow's own authoritative declaration is the meaningful analog here and uses
  the identical `reconcileGraph` function production reconcile calls.
- **Postgres backend not exercised** — this spike used the SQLite backend only
  (`sqliteAvailable()` gate, same as the b0nny.3 functional tests); the outbox/reconcile logic
  is backend-agnostic per `construct-b0nny.3`'s design, but that parity claim is not
  independently re-verified here.
- **Single-process, single-machine crashes only.** No test of a crash during a genuinely
  distributed write (e.g., an external API call whose response is lost mid-flight, leaving
  the write's true remote state ambiguous) — `external_write` here is a local file upsert, a
  reasonable stand-in but not a proof about real network-partition failure modes.

## Go/no-go verdict

**Go** for this workflow shape as a validated pattern for the production control plane's
governed-write pipeline (§6 of the directive: policies, approvals, effects), with one required
follow-up: any real `graph_update` stage must carry a durable idempotency guard against
redeclaring the same edge on a crash-forced redo, using the fix sketched above, before this
shape is copied into `E6` (policies/approvals/effects) or `E1` (graph foundation production
epic). Every other tested property — durable-checkpoint resume, node-level graph consistency,
stale-approval rejection, expired-credential blocking, mid-flight spec/plan-change detection,
clean cancellation, and lock-based supersession — held under a real, repeatable, twice-verified
process-kill matrix with no narrated steps. The recovery model (atomic-write checkpoints +
stage-granularity resume + boundary-checked cancellation/supersession) is sound enough to build
on; the one gap found is narrow, understood, and cheap to close.
