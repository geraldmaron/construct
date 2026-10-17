# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** none (the clean-state audit session ended 2026-10-17).
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
- Full gate green at the last commit. Not pushed, not merged.
- Personal skill copies on this Mac were refreshed from this branch (backups in
  `~/.claude/backups/20261017-skill-refresh/`).

## Next step
1. Merge the branch, then in the main checkout: `bash scripts/install-git-hooks.sh` (moves every checkout
   with `.githooks` off `.beads/hooks`), approve the project MCP server in Claude Code, then
   `claude mcp remove construct -s user` and confirm `construct doctor` shows host-wiring and host-hooks ok.
2. Complete the ledger items whose acceptance waited on the merge: `work-e34944dc`, `work-ceeac48f`,
   `work-145a8ce5`, `work-8d7a730a`, `work-53a4a038`, `work-ed80bdad`.

## Open questions
- Plugin distribution for the skills needs a skills-only package (§40).
- Worktree evidence identity: `work-57908b15`.
- Workflow merge, single claim authority, service/tools split and the tool-surface rewrite: §40, each its own change.
- ai-workflow-config still ships copies of seven Construct method skills; its next deploy overwrites the
  refreshed personal copies until it drops them.

## Files owned / in-flight
- None.
