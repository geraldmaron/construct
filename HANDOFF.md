# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** none after this session; alpha.32 awaits Gerald's go-ahead to push and tag.
**Mode:** B (Claude leads; Codex implements bounded slices in worktrees, Claude reviews and commits).

## What was done
- 3.0.0-alpha.32 is prepared on local `main` (39a80bf4): version bumped, CHANGELOG section written,
  release manifest recorded without native review (§48), smoke live record current and passing.
- Codex and gpt-6-astra are out of use (Gerald, 2026-10-17): no gated Codex eval cell, and the
  release manifest's `nativeReview` says unavailable under §48. The gate refuses a silent omission.
- Merged today: workflow consolidation (§44), Codex 0.163 reviewer (§47, not run for alpha.32),
  module split, shorter tool descriptions (measured before and after on Claude Code), claim-recovery
  hint, `USER` kept for host children, the Codex eval-home fix and the code-mode fix.

## Current state
- Local `main` is 66 commits ahead of `origin/main`; nothing is pushed or tagged.
- Gate on 39a80bf4: lint, typecheck, npm test 1,300 / 0, smoke, conformance 126 / 0,
  `evals-live check` passing, `release:check --tier=experimental-alpha` passing.
- All eval worktrees are removed; only the main checkout remains.

## Next step
1. On Gerald's word: push a `release/alpha.32` branch, open the PR to `main`, and after it merges
   tag `v3.0.0-alpha.32` on the merge commit and push the tag (release.yml publishes under `alpha`).
2. Then: work-f6a6a2ba (a Claude Code held-text reviewer) and work-51bcd5b9's live criterion (a
   Claude scenario that plants a settled statement and a superseded document).

## Open questions
- Backlog after triage: about 40 genuine items (sources, standing outcomes, hook unification, live
  evidence, product-scale design). None blocks the alpha.
- The reviewer's app-server session also reads `$CODEX_HOME/AGENTS.md`. Its controls passed, but a
  dedicated CODEX_HOME would make it independent of the person's instructions too.

## Files owned / in-flight
- None.
