# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** none (the reconciliation session ended 2026-10-17).
**Mode:** B (Claude implemented, Codex cross-reviewed).

## What was done
- Everything from 2026-10-17 is reconciled onto local `main`. That covers the residency amendment and
  Tier 1 timer, Hermes Agent as a host, the trigger-word removal, the smaller skill manifest, the
  clean-state audit (§40), its deferred decisions (§41), worktree evidence identity (§42) and desktop
  lane detection (§43).
- The worktree-evidence and lane commits started from the old `origin/main`. They were ported as
  9c92a5bb and 82cf9e74: Biome formatting was normalized first, so the three-way merge had no conflicts.

## Current state
- Local `main` is 32 commits ahead of `origin/main` (with this HANDOFF commit); nothing is pushed.
- Full gate green on `main`: lint, typecheck, npm test 1239 pass / 0 fail, smoke, conformance 126 / 0.
- Local branches left: `main`, plus four `claude/*` branches whose content is in `main`. Each is still
  checked out by an idle linked session's worktree under `.claude/worktrees/`.
- Untracked and left alone: `.beads/` (the retired tracker's data; nothing reads it any more) and the
  `docs/internal/*` evidence folders that were untracked before this work started.

## Next step
1. Push `main`, or open a PR from it, when the release side effects are wanted.
2. Archive the four idle sessions (timer, worktree evidence, lane detection, workflow/MCP decisions).
   That removes their worktrees; then delete their `claude/*` branches.

## Open questions
- Open ledger items: work-0a9a9c24 (timer defects, likely fixed by a3d87da0 but its live launchd
  check is unrecorded), work-bdb9137a (the audit outcome), work-4503dc02, work-51bcd5b9,
  work-db112a00, work-0a36e600, work-c3476f42, work-ed80bdad and work-225d1807 (stakes, gated on
  a live eval record).
- `.beads/` can be deleted once nobody needs the old tracker history.
- ai-workflow-config still ships copies of seven Construct method skills.

## Files owned / in-flight
- None.
