# Spike C harness — parallel software change validation

Scripts and specs used for construct-b0nny.5.3. Disposable: nothing here runs
against the real `feat/workspace-control-plane` worktree. All scratch git state
lived under a tmp scratchpad directory (outside this repo's own worktree tree)
and was deleted at the end of the spike — see `spike-c-parallel-software-change.md`
in `../../synthesis/` for the full report, evidence, and verdict.

Files:
- `worker-specs.md` — the three execution-ready work specs (file, change,
  acceptance criteria) handed verbatim to the three parallel Agent-tool workers.
- `setup-scratch.sh` — clones the worktree into a scratch dir and creates one
  throwaway git worktree per sub-task, each on its own branch.
- `merge-and-test.sh` — creates a scratch integration worktree, merges the
  three worker branches into it, and runs the full suite (`npm test`) against
  the merged tree.
- `teardown.sh` — removes every worktree/branch/clone this spike created.
- `graph-independence-check.sh` — the exact `construct graph query` commands
  used to prove the three target files share no dependents (graph-informed
  decomposition evidence).
