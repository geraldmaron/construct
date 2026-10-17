# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** Claude Code (loose-ends session, outcome work-c22d18c1), 2026-10-17.
**Mode:** B (Claude leads; Codex implements bounded slices in worktrees, Claude reviews and commits).

## What was done
- The workflow consolidation (§44) is merged: `review` and `authoring` 2.0.0, keyed by domain, with
  every former id resolving through an alias. 12 workflows remain.
- The native reviewer is requalified on Codex 0.163.0 (§47) and passed its three live controls; the
  release gate accepted the record.
- Beads is retired everywhere and its data deleted. Six stale ledger items were closed after a triage.
- The Codex eval canary now names its own failure: Codex reads `$CODEX_HOME/AGENTS.md` whatever
  `--ignore-user-config` says, so a clean eval run needs a CODEX_HOME of its own.
- CHANGELOG `Unreleased` lists every breaking change since alpha.31.

## Current state
- Local `main` is ahead of `origin/main`; nothing is pushed.
- Smoke candidate cells (main) are done: Codex missed 18/34 (alpha.31 24/34), Claude haiku crowded
  30/34 (alpha.31 32/34), 0 false writes. The record needs the preregistered baselines
  staging-79562bbc and alpha.25 (worktrees `../construct-staging79`, `../construct-alpha25`); those
  four cells are running.
- Tool descriptions (work-4503dc02) rewritten on branch `desc` (worktree `../construct-desc`); its
  test-split cells are running for before/after against the main candidate batches.
- work-f740fec5 fixed (140b343c): a refusal over work held by another agent of the caller's session
  names the main agent's takeover. work-32615d2f closed; work-c3476f42 held by this session's main
  agent until the record passes.

## Next step
1. When the baselines finish: `record --scope=smoke --batches=<the real batches>` and `check`.
2. When the desc cells finish: compare per axis with the main candidate; merge `desc` only if no axis
   is worse beyond the margin, and then record with the desc batches as the candidate.
3. Close work-225d1807, work-51bcd5b9, work-c3476f42, work-26313b45, work-4503dc02, work-ed80bdad.
4. Release 3.0.0-alpha.32: bump, CHANGELOG heading, `release:live` (with `env -u ANTHROPIC_BASE_URL`),
   `release:check --tier=experimental-alpha`. Push, tag and publish only on Gerald's word.
5. Remove the eval worktrees (`construct-alpha31`, `construct-staging79`, `construct-alpha25`,
   `construct-desc` after merge).

## Open questions
- Backlog after triage: about 40 genuine items (sources, standing outcomes, hook unification, live
  evidence, product-scale design). None blocks the alpha.
- The reviewer's app-server session also reads `$CODEX_HOME/AGENTS.md`. Its controls passed, but a
  dedicated CODEX_HOME would make it independent of the person's instructions too.

## Files owned / in-flight
- `../construct-desc` (branch `desc`): src/kernel/broker/tools/ descriptions (work-4503dc02).
- Eval baseline worktrees, detached: `../construct-alpha31`, `../construct-staging79`, `../construct-alpha25`.
