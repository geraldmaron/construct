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
- The module split (work-db112a00) is merged as 006eb69b: tools/list is byte-identical
  (2e0d9e9d…174a), npm test 1,298 pass / 0 fail, smoke and conformance 126 / 0.
- Codex evals work again (8532ccb7): runs keep the code-mode host Codex 0.163 calls MCP tools
  through, and use the signed-in eval home `~/.local/share/construct-evals/codex-home`. Preflight
  passes there and still fails, as it should, under the real `~/.codex`.
- Running: Codex smoke cells, candidate then baseline `v3.0.0-alpha.31` (worktree
  `../construct-alpha31`), logs in the session scratchpad.

## Next step
1. Gerald signs in to the `claude` CLI (`claude`, then `/login`); the Claude Code smoke cell
   (haiku, crowded) needs it.
2. Run that cell for candidate and baseline, then `record --scope=smoke` and `check`.
3. With the record: close work-225d1807, work-51bcd5b9, work-c3476f42, work-26313b45; do the
   tool-description change (work-4503dc02) with before/after runs; close work-ed80bdad.
4. Release 3.0.0-alpha.32: bump, CHANGELOG heading, `release:live` (run with
   `env -u ANTHROPIC_BASE_URL`), `release:check --tier=experimental-alpha`. Push, tag and publish
   only on Gerald's word.

## Open questions
- Backlog after triage: about 40 genuine items (sources, standing outcomes, hook unification, live
  evidence, product-scale design). None blocks the alpha.
- The reviewer's app-server session also reads `$CODEX_HOME/AGENTS.md`. Its controls passed, but a
  dedicated CODEX_HOME would make it independent of the person's instructions too.

## Files owned / in-flight
- `../construct-alpha31`: detached at v3.0.0-alpha.31 for the eval baseline; remove after the record.
