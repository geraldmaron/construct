# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** none (the clean-state audit session ended 2026-10-17, after the merge into main).
**Mode:** B (Claude implemented, Codex cross-reviewed every slice).

## What was done
- Branch `claude/laughing-borg-fd48a4` (worktree `.claude/worktrees/laughing-borg-fd48a4`), built on
  `feat/hermes-host`: the Tier 1 platform timer and the clean-state audit. RESEARCH-DECISIONS §40 records
  what was cut, what was kept and why. Ledger: outcome `work-bdb9137a` and its children.
- Timer review fixes, Biome formatter/linter in the gate, CONTRIBUTING.md, the Beads tracker and its hooks
  removed (hooks now in `.githooks`), raw evidence out of `docs/internal`, the 2.x import paths removed,
  skills/evals on the Agent Skills shape with dev-only eval code out of the package, unclaimed-edit notes
  at PostToolUse and Stop, doctor failing stale personal skills, committed portable `.mcp.json` and hooks,
  and narrower prose validators.

## Current state
- Merged into local `main` by fast-forward on 2026-10-17 (main checkout now on `main`); `origin/main` is
  behind and nothing is pushed. Full gate green on `main` in the main checkout.
- `bash scripts/install-git-hooks.sh` ran: the main checkout and every worktree carrying `.githooks` use it;
  checkouts on older branches still resolve the untracked `.beads/hooks`, so that folder stays until they rebase.
- Construct reaches the main checkout through the committed `.mcp.json` (approved in the gitignored
  `.claude/settings.local.json`); the user-scope entry is removed. `construct doctor` there reports the
  installation healthy. Backups: `~/.claude/backups/20261017-post-merge/`.
- Personal skill copies on this Mac were refreshed from this branch (backups in
  `~/.claude/backups/20261017-skill-refresh/`).

## Next step
1. Push `main` (or open a PR from it) when the release side effects are wanted.
2. Checkouts without the committed `.mcp.json` (construct-hermes-host, construct-tier1-residency, and the
   intelligent-northcutt and quizzical-cannon worktrees) get no Construct in new sessions until they merge `main`.
3. Branches waiting: `claude/quizzical-cannon-bb8975` (worktree evidence identity) and
   `claude/elated-lamport-b176e0` (§41 decisions, owner input removed; carries `work-ed80bdad`).

## Open questions
- Plugin distribution for the skills needs a skills-only package (§40).
- Worktree evidence identity: `work-57908b15`.
- Workflow merge, single claim authority, service/tools split and the tool-surface rewrite: §40, each its own change.
- ai-workflow-config still ships copies of seven Construct method skills; its next deploy overwrites the
  refreshed personal copies until it drops them.

## Files owned / in-flight
- None.
