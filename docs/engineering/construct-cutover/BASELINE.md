# Cutover baseline

Recorded: 2026-09-20. Mapper: Cursor Grok 4.6 session.

## Checkout

- Repository: `geraldmaron/construct` at `/Users/geralddagher/Developer/Projects/construct`
- Branch: `staging` (tracks `origin/staging`)
- HEAD: `d8171157cc038096b78429a459cf83dcbca70aea` — identical to the supplied audit revision
- Package: `@geraldmaron/construct` `3.0.0-alpha.25`
- Worktrees: this checkout only
- Relation to staging: on staging, not ahead, not behind
- Unrelated dirty/untracked (preserved, not part of this cutover):
  - `.construct/constitution.json`
  - `.construct/project.json`
  - `.construct/registry.lock.json`
  - `.construct/sources.json`
  - `.construct/state/` (gitignored runtime)

No other uncommitted source changes existed at capture.

## Runtime

- Declared engine: Node `>=22.18.0`
- This session: Node `v24.19.0`, npm `11.17.0`, darwin arm64
- The audit's 17 module probes ran on Node 22.16 (below the declared minimum). That limit is evidence about the audit, not about this checkout.

## Tracker source (Beads)

- `bd` `1.0.3` (`1b2dd2cb`), backend `dolt` embedded, mode `direct`
- Database: `.beads/embeddeddolt`, project id `8954b3eb-1a7e-498a-9fa8-5f1d5954e91b`
- Counts at capture: 566 issues (6 open, 0 in progress, 560 closed)
- Open ids: `construct-plnm`, `construct-15z8`, `construct-c54e`, `construct-1pno`, `construct-a9yx`, `construct-eu57`
- Export `.beads/issues.jsonl` exists but is not live truth; live backend is embedded Dolt
- No Dolt remote is configured (`bd dolt push` is not a recovery path)

## Documented gates at this revision

`npm run lint && npm run typecheck && npm test && npm run smoke`

Also present: `npm run conformance`, `npm run evals:live`, `npm run reconcile` (Beads-specific; to be retired).

## Audit limits that stay in the evidence record

The supplied audit examined this same commit. Its 17 probes were not a full supported-runtime suite, not a live-host benchmark, and not a live tracker migration. Lifecycle findings included source inspection without end-to-end reproduction. Those limits do not discard the findings; they prevent labeling an imported observation as a test this session ran.
