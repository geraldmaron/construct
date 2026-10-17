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
- Local `main` is 50 commits ahead of `origin/main`; nothing is pushed.
- Full gate green on the workflow-merge commit (lint, typecheck, tests, smoke, conformance 126 / 0).
- In flight: Codex is splitting `work/service.ts` and `broker/tools.ts` (work-db112a00) in worktree
  `../construct-split`, branch `codex/split`. The tools/list digest before the split is
  2e0d9e9d…174a (46,109 bytes); it must match after.

## Next step
1. Two one-time sign-ins by Gerald unblock every live eval: `claude` then `/login` in a terminal
   (the CLI is not signed in outside the desktop app), and
   `mkdir -p ~/.local/share/construct-evals/codex-home` then `CODEX_HOME=~/.local/share/construct-evals/codex-home codex login`.
2. Then run the smoke record with `CODEX_HOME` set to that home: preflight both hosts, the
   candidate cells, and a baseline from `v3.0.0-alpha.31`; then `record --scope=smoke`.
3. With the record: close work-225d1807, work-51bcd5b9, work-c3476f42; do the tool-description
   change (work-4503dc02) with before/after runs; close work-ed80bdad.
4. Release 3.0.0-alpha.32: bump, CHANGELOG heading, `release:live`, `release:check
   --tier=experimental-alpha`. Push, tag and publish only on Gerald's word.

## Open questions
- Backlog after triage: about 40 genuine items (sources, standing outcomes, hook unification, live
  evidence, product-scale design). None blocks the alpha.
- The reviewer's app-server session also reads `$CODEX_HOME/AGENTS.md`. Its controls passed, but a
  dedicated CODEX_HOME would make it independent of the person's instructions too.

## Files owned / in-flight
- `../construct-split`: src/kernel/work/, src/kernel/broker/ and their tests (work-db112a00).
