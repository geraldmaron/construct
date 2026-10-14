# Local branch and worktree reconciliation

Completed 2026-10-14 in the primary checkout on `codex/reconciled-construct`.
Integration commit: `7d6f71d33c4ba07f260ccbf3bf2657a8c0df4cc9`.
It retains both parents:

- Documentation: `a1b6e475b1ee09b6d716fa3b09efa13bde8b4c01`.
- Source/command remediation: `7a509a1e33db4ce3069b8206017cbaf7567c2f54`.

Remote references were refreshed with `git fetch --prune origin`. Both unique
local histories were merged without conflicts. Every staged product/test file
was byte-identical to one reviewed parent; only five documentation files differed
from both parents. Those combined guides were reviewed. The source guide now also
explains explicit capability-file repair and snapshot metadata behavior.

## Validation on the integrated tree

Check: real project gate.
Command: `npm run lint && npm run typecheck && npm test && npm run smoke`
Result: pass, exit 0.
Observed: 1,140 total, 1,139 passed, zero failed, one skipped; packaged smoke passed.
Log: `/private/tmp/construct-reconciliation-gate.log`.

Check: static supported-host conformance.
Command: `npm run conformance -- --out=/private/tmp/construct-reconciliation-conformance.json`
Result: pass.
Observed: 97 passed, zero failed, 19 untested native boundaries.
Log: `/private/tmp/construct-reconciliation-conformance.log`.

Check: actual CLI recovery scenarios.
Command: `node docs/internal/command-remediation/verify-surfaces.mjs`
Result: pass.
Observed: ten scenarios and sequential control passed; concurrent sources both active.
Log: `/private/tmp/construct-reconciliation-surfaces.log`.

Check: final combined source guide and documentation contract.
Command: `npm run lint`
Result: pass before integration commit.
Observed: all configured lint/generated-document checks passed.
Log: `/private/tmp/construct-reconciliation-doc-lint.log`.

## Pruning and preservation

The only remaining checkout is `/Users/geralddagher/Developer/Projects/construct`.
Local branches retained: `codex/reconciled-construct` and `main`. Local `main` was
fast-forwarded to the already-fetched `origin/main` at
`0b94218709cdf15c2179ad9d62e3428f135e67ef`; no new merge was made onto main.

Five local branch names were removed after proving their tips ancestors of the
integration branch: `codex/docs-current-surfaces`, `codex/source-activation-cli`,
`dev/fresh-delivery-reliability`, `docs/current-at-alpha-26`, and `staging`.
Remote branches and release tags were not deleted or changed. Nothing was pushed.

The redundant managed checkout was removed and `git worktree prune` completed.
The managed archiver returned only `queued` twice and supplied no completed archive
receipt. Cleanup therefore used an independent recoverable Git snapshot before
local removal; this is not represented as completed native-app archival.

Snapshot ref: `refs/tags/archive/source-activation-cli-2026-10-14`.
Snapshot commit: `3e13d7736a6e797020844b9940e38d9d7f5af882`.
Parent: the integrated remediation tip `7a509a1e33db4ce3069b8206017cbaf7567c2f54`.
All 18 previously untracked files under `docs/internal/command-audit/` were
byte-verified against the snapshot before removal. The archive ref is a local
recovery tag, not a release or publication. The historical audit remains historical;
it was not added to the active documentation as current product behavior.

Three ignored native-preflight evidence files were copied and hash-checked under
`.tmp-evals/source-activation-cli-7a509a1e/` in the primary checkout. The hook-health
cache was also preserved there under `hook-health-cache/`. Generated build output
and the dependency checkout were disposable; primary dependencies remain available.
The snapshot and copied evidence preserve the unique work independently of the
queued app action. The app attachment still reported a worktree after local removal;
its UI bookkeeping completion was not observed.

## Work reconciliation and limits

The expired claim on `work-79b6e69d` ended on 2026-10-10. It was taken over solely
to release stale ownership, then left open with its acceptance criteria unchanged.
Completed remediation and subagent-review work remain completed. Open native
isolation, broad documentation-review, implementation-review, setup/task-interface
and wider qualification items remain open; pruning does not establish their
acceptance or independent assurance. In particular, the old main-bound managed
generation remains unaccepted, and the historical failed native candidate judgment
is retained. No release, full-readiness promotion or native desktop clearance.

Strongest failure: deleting the sole copy of audit or failed preflight evidence.
Control: merge ancestry checks, byte-verified recoverable snapshot and separate
ignored-evidence preservation before removal. Alternative: keep the duplicate
checkout indefinitely. Decision: accepted with these recovery controls and explicit
native-app archival limits.
