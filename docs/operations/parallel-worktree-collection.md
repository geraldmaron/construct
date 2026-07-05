# Parallel worktree-agent collection

When multiple worktree-isolated agents work the same remediation wave in parallel and their output is collected into one working tree for a single commit, the collection step is where regressions hide: each agent's targeted tests passed in its own isolated worktree, but the collected result has never been run as a whole.

## The failure mode

Agents branch their worktrees at different times. An agent that branched *before* an earlier wave's fix landed still has the pre-fix version of any file that fix touched. If that agent's copy of the file is the one collected — because it was collected later, or a collision was resolved in its favor — the earlier fix is silently reverted. Per-bead targeted tests still pass, because each agent's own tests only exercise its own change; nothing re-runs the full suite across the merged result before commit.

This has happened: a set of parallel remediation-wave commits landed with regressions across multiple unrelated files (a reverted export and timeout guard, a reverted terminal-state fix with test assertions rewritten to match the regression, and dropped CLI wiring) that only surfaced later, when the full suite ran again. All were repaired in a follow-up commit. Every regression would have been caught by running the full gate once, on the merged result, before that commit.

## The mandatory steps

Collecting parallel worktree-agent output into the main tree and committing it requires, in order:

1. **Collect and hand-merge.** Bring each agent's output into the working tree; resolve file-level collisions.
2. **Collision-revert check.** For every file touched by more than one agent's worktree, run `git diff HEAD -- <file>` and read the removed lines. A removed line must be something *this* wave intentionally undoes — if it looks like it reverts an unrelated, already-landed fix, that is a stale-worktree collision, not an intended change. Fix it before moving on.
3. **Run the full gate — not a subset.**

   ```bash
   npm test
   npm run test:functional
   ```

   Use `npm test`, not a bare `node --test` invocation — bare `node --test` across this suite deadlocks the functional tests, which rely on `npm test`'s orchestration (see `scripts/run-tests.mjs`). Per-bead targeted tests are not a substitute here: they proved each agent's own change works in isolation, not that the merged result still does.
4. **Commit only after step 3 exits 0 for every file changed in the collection.** CI is a backstop for the pushed branch, not the primary gate for this step — a red commit that CI eventually catches has already landed as a regression in history.

## Why this is not covered by CI alone

CI runs after the push, on the commit that already exists. By the time CI reports red, the regression is committed — reverting or fixing it after the fact takes longer than catching it before the commit, and a fast-follow merge can land on top of the red commit before anyone notices. The full-gate-before-commit step exists specifically to catch collection-time regressions while they are still uncommitted.

## Related

- `CONTRIBUTING.md` § "Before opening a PR" — the full nine-check gate a change eventually needs before merge; this doc's step 3 is the minimum subset that must be green before the collection *commit*, not the full nine-check list.
- `docs/operations/maintenance/release-and-deploy.md` § "Pre-push gate" — a separate, narrower gate that runs before `git push`, not before commit.
- `rules/common/beads-hygiene.md` § "Parallel runs — verify the committed branch, never a stray worktree" — the verify-side rule: close evidence must be reproduced on the merged branch, not a worktree that no longer reflects it.
