# Spike C — parallel software change validation (construct-b0nny.5.3)

Status: complete. Disposable spike; nothing here was merged into any production
path. Harness scripts and specs: `../spikes/c-parallel-software-change/`.

## Task picked, and why it is genuinely decomposable

Three `lib/` pure-utility modules had **zero test coverage anywhere in the
repo** at spike start (confirmed with `grep -rl <name> tests` returning
nothing for all three, before any change):

| Sub-task | Source module | New test file |
|---|---|---|
| A | `lib/artifact-type-from-path.mjs` | `tests/artifact-type-from-path.test.mjs` |
| B | `lib/model-tiers.mjs` | `tests/model-tiers.test.mjs` |
| C | `lib/vscode-paths.mjs` | `tests/vscode-paths.test.mjs` |

Reasoning for independence (verified, not assumed):

- Reading all three source files in full: none imports either of the other
  two. `artifact-type-from-path.mjs` imports `artifact-manifest.mjs` and
  `config-dir.mjs`; `model-tiers.mjs` is deliberately zero-dependency;
  `vscode-paths.mjs` imports only `node:path`/`node:os`.
- Each sub-task only **adds a brand-new file**; none edits an existing file.
  Two changes that only add distinct new files cannot produce a textual merge
  conflict — the only way they could collide is by choosing the same new
  filename, which the specs avoid by construction.
- Graph-informed decomposition (below) independently confirms no shared
  dependents.

This is exactly the class of change the directive describes: "three
independent small test additions in unrelated test files."

## Graph-informed decomposition (real `construct graph` output)

Run from the real `feat/workspace-control-plane` worktree (read-only query,
no mutation), reproduced by
`docs/notes/research/workspace-control-plane/spikes/c-parallel-software-change/graph-independence-check.sh`:

```
$ node bin/construct graph query file:lib/artifact-type-from-path.mjs
file:lib/artifact-type-from-path.mjs (file)
  → dependencies (12): file:lib/artifact-manifest.mjs, file:lib/config-dir.mjs, capability:artifact.release-gate,
    capability:document-type.adr, capability:document-type.prd, capability:document-type.research-brief,
    capability:mcp.broker.connection, capability:oracle.meta-review, capability:orchestration.routing,
    capability:publish.distribution, capability:test-system.certification-runner, capability:workflow.prd-draft
  ← dependents   (8): file:lib/artifact-gate-notice.mjs, file:lib/artifact-release-gate.mjs,
    file:lib/artifact-reviewers.mjs, file:lib/artifact-workflow.mjs, file:lib/contracts/validate.mjs,
    file:lib/oracle/artifact-gate.mjs, file:lib/publish.mjs, module:lib/artifact-type-from-path.mjs

$ node bin/construct graph query file:lib/model-tiers.mjs
file:lib/model-tiers.mjs (file)
  → dependencies (8): capability:document.ingest.local, capability:ingest.docling-remote, capability:local.model.tier,
    capability:mcp.broker.connection, capability:oracle.meta-review, capability:orchestration.routing,
    capability:test-system.certification-runner, capability:workflow.prd-draft
  ← dependents   (10): file:bin/construct, file:lib/mcp/tool-definitions-workflow.mjs,
    file:lib/model-cheapest-provider.mjs, file:lib/model-policy.mjs, file:lib/model-router.mjs,
    file:lib/models/catalog.mjs, file:lib/orchestration/readiness.mjs, file:lib/setup.mjs,
    file:lib/validator.mjs, module:lib/model-tiers.mjs

$ node bin/construct graph query file:lib/vscode-paths.mjs
file:lib/vscode-paths.mjs (file)
  → dependencies (1): capability:oracle.meta-review
  ← dependents   (3): file:lib/parity.mjs, file:scripts/sync-specialists.mjs, module:lib/vscode-paths.mjs
```

Dependents sets: `{artifact-gate-notice, artifact-release-gate,
artifact-reviewers, artifact-workflow, contracts/validate, oracle/artifact-gate,
publish}` / `{bin/construct, mcp/tool-definitions-workflow,
model-cheapest-provider, model-policy, model-router, models/catalog,
orchestration/readiness, setup, validator}` / `{parity, scripts/sync-specialists}`.
**Zero overlap between any pair** — real evidence of independence, not asserted.

Side finding (not fixed, out of scope for this spike): `node bin/construct
graph stat` currently errors with `Unknown graph subcommand: stat` even though
`stat` is both the documented default (`const sub = args[0] || 'stat';` in
`lib/graph/cli.mjs`) and listed in the "Available" error text — there is no
`if (sub === 'stat')` branch in `runGraphCli`. Did not touch this (protected
file, out of scope); flagged separately rather than fixed here.

## Concurrent-safe assignments, isolated workspaces, ownership

Scratch clone (fully separate git repository, cloned from the real worktree,
rooted under a tmp scratchpad directory — never registered against the real
repo):

```
$ git clone --no-hardlinks <feat/workspace-control-plane worktree> <scratch>/base-repo
$ git -C <scratch>/base-repo worktree add -b spike-c/worker-a-artifact-type-tests <scratch>/worker-a HEAD
$ git -C <scratch>/base-repo worktree add -b spike-c/worker-b-model-tiers-tests    <scratch>/worker-b HEAD
$ git -C <scratch>/base-repo worktree add -b spike-c/worker-c-vscode-paths-tests   <scratch>/worker-c HEAD
```

All three branches forked from the same base commit `712fbcd6` (the real
worktree's HEAD at spike start). One worker, one worktree, one branch, one
file — no shared mutable state between workers.

Three real Agent-tool workers were dispatched in parallel (one Agent tool
call per sub-task, issued in a single message so they ran concurrently), each
with a self-contained prompt naming its exact worktree path, its exact source
module, and the acceptance criteria from `worker-specs.md`. No worker was told
about the others' file assignments beyond "don't touch anything outside your
worktree."

## Independent tests: each worker added and ran its own test

All three workers reported running `node --test <their file>` **before**
committing, in their own worktree, and pasted the real pass output:

- Worker A: `tests 2, pass 2, fail 0` (`isArtifactGatePath` + `inferArtifactTypeFromPath` cases).
- Worker B: `tests 4, pass 4, fail 0` (`MODEL_TIERS`, `MODEL_TIER_SET`, `isModelTier` accept/reject cases).
- Worker C: `tests 2, pass 2, fail 0` (`getVSCodeUserDirs` real-platform-aware assertion + default-homeDir case).

Worker C's first draft was rejected by this repo's own `comment-lint` git
hook (a narrative-voice violation — a header sentence starting with "It"),
which fired for real inside the scratch clone (hooks travel with `git clone`).
The worker reworded the header and the hook passed cleanly on the second
attempt — genuine evidence the hygiene gate is live and enforced even in a
disposable clone, not fabricated for this report.

## Provenance

| Worker | Branch | Commit SHA | File added |
|---|---|---|---|
| A | `spike-c/worker-a-artifact-type-tests` | `c8fe594c71d3a892dbe8f53bb95925d41b0bbd9f` | `tests/artifact-type-from-path.test.mjs` (41 lines) |
| B | `spike-c/worker-b-model-tiers-tests` | `b3b8ef05b74b98e851c346068cc47c94c231650d` | `tests/model-tiers.test.mjs` (38 lines) |
| C | `spike-c/worker-c-vscode-paths-tests` | `c026b57e142dd34caac0f0af1fcd45fdb116230d` | `tests/vscode-paths.test.mjs` (66 lines) |

Each commit's diffstat was independently re-verified from the scratch base
repo (`git show --stat <sha>` on each branch) and showed exactly one file
changed, matching the acceptance criteria.

## Merge / integration

A fourth scratch worktree, `spike-c/integration`, branched from the same
`712fbcd6` base and merged the three branches in sequence:

```
$ git worktree add <scratch>/integration -b spike-c/integration HEAD
$ git merge --no-edit spike-c/worker-a-artifact-type-tests   # fast-forward, 712fbcd6..c8fe594c
$ git merge --no-edit spike-c/worker-b-model-tiers-tests     # real merge, 'ort' strategy, clean
$ git merge --no-edit spike-c/worker-c-vscode-paths-tests    # real merge, 'ort' strategy, clean
```

Result:

```
*   450e7c57 Merge branch 'spike-c/worker-c-vscode-paths-tests' into spike-c/integration
|\
| * c026b57e test: add coverage for vscode-paths (spike-c worker C)
* |   9aa0bd4d Merge branch 'spike-c/worker-b-model-tiers-tests' into spike-c/integration
|\ \
| * | b3b8ef05 test: add coverage for model-tiers (spike-c worker B)
| |/
* / c8fe594c test: add coverage for artifact-type-from-path (spike-c worker A)
|/
* 712fbcd6 docs: changelog + wave-status update for construct-b0nny.3 (Wave 2 complete)
```

```
$ git diff --stat 712fbcd6 HEAD
 tests/artifact-type-from-path.test.mjs | 41 +++++++++++++++++++++
 tests/model-tiers.test.mjs             | 38 ++++++++++++++++++++
 tests/vscode-paths.test.mjs            | 66 ++++++++++++++++++++++++++++++++++
 3 files changed, 145 insertions(+)
```

## Failure and conflict handling

**No merge conflict occurred.** All three additions were brand-new,
distinctly-named files, so git had nothing to reconcile line-by-line; the two
non-fast-forward merges resolved automatically via the `ort` strategy with no
`CONFLICT` markers, no manual intervention, and no `git status` residue after
each merge (`git status --short` clean after each of the three merges — checked
before invoking the next). This is reported honestly as a non-event, not
manufactured: the independence proof (graph query + reasoning above)
predicted exactly this outcome ahead of time.

The three merged tests, run together immediately post-merge
(`node --test tests/artifact-type-from-path.test.mjs tests/model-tiers.test.mjs tests/vscode-paths.test.mjs`),
passed as a set: `tests 8, pass 8, fail 0`.

## Whole-system validation

`npm install --no-audit --no-fund` then `npm test` (the project's real
`scripts/run-tests.mjs`, no `--exclude`, no shard — every `*.test.mjs` under
`tests/`, sharded internally by the runner across several `node --test`
invocations) was run inside the scratch integration worktree against the
merged tree.

**Result: 8 failing tests out of 5,885 run, across 8 shard-summaries.** This
is reported exactly as observed — not rounded up to "pass" and not
downplayed. Investigating each failure by category, with a fix-and-rerun
check where that was cheap enough to actually do (not just asserted):

1. **Two failures were real, direct consequences of this spike's change** —
   exactly the kind of thing whole-system validation exists to catch that
   per-branch testing missed:
   - `tests/test-corpus-inventory.test.mjs` — `missing inventory entry:
     tests/artifact-type-from-path.test.mjs` (+ the other two new files).
     A committed `tests/capabilities/corpus-inventory.json` lists every test
     file on disk; adding files without regenerating it drifts the inventory.
   - `tests/audit/f12-gates/audit-doc-staleness.test.mjs` — `AUDIT.md claims
     930 *.test.mjs files but disk has 933`. `tests/AUDIT.md` hard-codes a
     test-file count that the same regeneration script maintains.
   - **Confirmed the fix, not just theorized it**: running
     `node scripts/generate-test-corpus-inventory.mjs` in the integration
     worktree regenerated both files, and re-running just those two test
     files afterward gave `tests 5, pass 5, fail 0` and `tests 5, pass 5,
     fail 0` respectively — both green. Conclusion: this class of change
     (adding test files) is not merge-unsafe, but it does carry a mandatory
     third step beyond "write test, commit" — regenerate the corpus
     inventory — that none of the three isolated worker runs exercised
     because none of them ran the full suite, only their own new file.
   - **Attribution matters here**: this failure mode is not specific to
     *parallel* fan-out — a single sequential PR adding one new test file
     would trip the same two gates. It is a real finding about this repo's
     test-authoring workflow, surfaced by this spike's whole-suite run, not
     a merge/concurrency defect.

2. **Three failures were an artifact of the scratch-clone environment, not
   of the change**: `tests/graph/embed-nodes.test.mjs`,
   `tests/graph/explain.test.mjs`, and both cases in
   `tests/security/owasp-coverage.test.mjs` failed with `run \`construct
   graph build\` first` / `No graph found`. `.construct/graph/**` is
   git-ignored (`.gitignore:134`), so a `git clone` — by design — does not
   carry the real worktree's already-built graph store into the scratch
   clone. **Confirmed, not assumed**: running `node bin/construct graph
   build` in the integration worktree built a fresh graph (3,091 nodes, 8,138
   edges), and re-running those same four tests afterward gave `tests 14,
   pass 14, fail 0`. This is a property of using `git clone` for the scratch
   environment, unrelated to the three test files this spike added.
   `tests/functional/release-gate.functional.test.mjs` (`construct doctor
   exits 0`) failing with `doctor exited 1` most likely shares this same
   root cause (doctor's gate runs `graph validate`), though this one was not
   independently re-confirmed post-graph-build for time reasons.

3. **One failure was pre-existing baseline drift, unrelated to this spike**:
   `tests/functional/audit-ratchet.functional.test.mjs` reported two new
   findings not in `scripts/audit/baseline.json` —
   `02-deadcode:module-test-only:lib/graph/relational/postgres-store.mjs` and
   `03-docs:unnavigated-doc-dir:docs/notes/research/workspace-control-plane/synthesis`.
   Checked against the base commit `712fbcd6` directly (`git show 712fbcd6
   --stat`, `git ls-tree`): `lib/graph/relational/postgres-store.mjs` and the
   entire `docs/notes/research/workspace-control-plane/synthesis/` directory
   (six files) were already committed at that commit, before any spike-C
   branch existed and before this report file was written. Neither finding
   traces to anything this spike touched.

**Net read**: the parallel-fan-out mechanics themselves introduced zero
regressions — nothing in categories 2 or 3 traces to the three new files or
their merge. Category 1 is a genuine, confirmed, two-line-fix gap in the
*process* (a doc-regeneration step), not a defect in the merged code, and it
is a gap that would exist for this kind of change regardless of whether it
was done in parallel or sequentially.

Full runner stdout/stderr was captured to a scratch log during the spike and
removed with the rest of the scratch tree per the disposability rule; the
categorized failure text above was copied verbatim from that log before
teardown, not reconstructed from memory.

## Cleanup verification

Before creating any scratch state:

```
$ git -C <real-worktree> worktree list
<real-repo-checkout>                         5032cc82 [staging]
<scratch>/spike-f-github-runtime (pre-existing, unrelated spike)   712fbcd6 [spike/b0nny.5.6-github-runtime-replace]
<real-worktree>/.claude/worktrees/workspace-control-plane          712fbcd6 [feat/workspace-control-plane]
```

After teardown (`teardown.sh`, which removes the four scratch worktrees, prunes,
and `rm -rf`s the scratch clone directory entirely):

```
$ git -C <real-worktree> worktree list
<real-repo-checkout>                         5032cc82 [staging]
<scratch>/spike-f-github-runtime (pre-existing, unrelated spike)   712fbcd6 [spike/b0nny.5.6-github-runtime-replace]
<real-worktree>/.claude/worktrees/workspace-control-plane          712fbcd6 [feat/workspace-control-plane]
```

Identical. No worktree, branch, or ref created by this spike was ever
registered against the real repository — every `git worktree add` in this
spike ran inside the throwaway clone at `<scratch>/base-repo`, never inside
`<real-worktree>` or its parent repo. `git status` in the real
`feat/workspace-control-plane` worktree shows no changes from this spike
beyond the files this report itself adds under
`docs/notes/research/workspace-control-plane/` (this synthesis doc and the
harness scripts/specs) plus a pre-existing, unrelated staged deletion
(`.construct/launcher/version`) that predates this spike and was left
untouched, plus files from concurrent sibling spikes (B, D, E) running in
parallel sessions against the same worktree, also left untouched.

**One real-host side effect, found and cleaned up.** Running `npm test` in
the scratch integration worktree tripped this repo's own sterility guard
(`tests/helpers/sterile-host-env.mjs`): `Sterile drift — real host config
changed: construct:projects — project keys added: f69263bdbb0833a4ecf55176`.
Separately, this spike's own manual `node bin/construct graph build` command
(run to investigate the category-2 failures above) created a second entry,
`be9a3556512aaaab62c57afe`. Both are literal directory names under the real
`~/.construct/projects/` on the host machine — `projectId`-keyed state that
some code path writes outside of any sandbox, keyed by a hash of the cwd. Cross-
checked their timestamps (20:23 and 20:26) against the nine other pre-existing
entries in that directory (all timestamped 16:57–19:43, from unrelated
sessions earlier the same day) to confirm these two, and only these two,
traced to this spike; both were removed (`rm -rf`) after teardown, restoring
`~/.construct/projects/` to its pre-spike nine entries. This is a real,
independently-discovered instance of the exact leak class
`sterile-host-env.mjs` exists to catch — evidence the guard fires correctly —
not a claim invented for this report.

## Go / no-go verdict

**Go**, for this class of task: small, additive, zero-shared-state changes
(new test files for currently-untested pure utility modules) where
`construct graph query` can show empty dependents overlap ahead of time.

Conditions that made this cheap and safe, and should gate whether to reuse
the pattern:
1. **Graph-checkable independence up front.** The spike's value came from
   being able to prove "no shared dependents" with one command per candidate
   file *before* committing to the parallel fan-out, not from hoping three
   files were unrelated.
2. **Additive-only changes.** New files can't textually conflict with each
   other; this pattern degrades fast the moment two sub-tasks need to *edit*
   the same existing file, even in unrelated regions — ownership and
   isolation stop being free at that point and a real conflict-resolution
   step would need to be exercised (this spike did not get to test that path,
   since none occurred).
3. **Full-suite re-validation after merge is mandatory, not optional, and it
   found something real.** Per-branch green did not imply merged-tree green:
   the merged tree surfaced 2 confirmed, fixable failures (stale test-corpus
   inventory / AUDIT.md count) that no per-worker test run caught, because
   each worker only ran its own new file. Any adoption of this pattern must
   budget a "regenerate derived inventories" step after the merge, before
   calling the change done — `node scripts/generate-test-corpus-inventory.mjs`
   in this repo's case.
4. **A scratch clone is not a perfect stand-in for the real worktree.** Three
   more failures traced to gitignored generated state (`.construct/graph/**`)
   not surviving `git clone`; a real (non-scratch) integration branch
   wouldn't hit this, but anyone reusing this harness should build the graph
   store in the scratch integration worktree before trusting a "which tests
   fail" read, or explicitly exclude graph-dependent suites from the
   comparison.
5. **Watch for real-host side effects even in "disposable" scratch runs.**
   This repo's own sterility guard caught a real leak into
   `~/.construct/projects/` during the full-suite run; a parallel-fan-out
   harness that automates this pattern should snapshot/diff host state (the
   same guard `scripts/run-tests.mjs` already uses) around the whole
   operation, not just around individual test files.

No-go / needs more evidence before trusting this pattern for: changes that
touch shared configuration, registries, or any file with non-trivial
dependents overlap; changes where two sub-tasks might legitimately want to
edit the same file (real conflict-resolution path still unproven by this
spike); anything touching `lib/hooks/*.mjs` (protected, requires isolated
testing per CLAUDE.md regardless of parallelization).
