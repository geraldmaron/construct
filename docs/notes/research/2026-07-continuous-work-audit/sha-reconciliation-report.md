---
title: SHA-citation reconciliation report (construct-4uxq0.16)
description: Per-bead disposition of the dangling and unresolvable close-reason SHA citations left over from the invariant live run — every row re-verifiable from the recorded git commands.
intake: none
---

# SHA-citation reconciliation — construct-4uxq0.16

Follow-up to [invariant-live-run-remediation.md](invariant-live-run-remediation.md). That doc left two working sets: beads citing a commit that exists locally but is unreachable from any branch (List A, preserved as `refs/preserve/<bead-id>`), and beads citing a SHA-shaped token not resolvable in this repo at all (List B).

Lists were regenerated live on 2026-07-16 (`node bin/construct oracle invariants --json`, first invariant), not taken from the prior doc's snapshot: 69 violations + 30 unresolved. Of the 69 violations, 36 are reachable from a real pushed branch (`git branch -a --contains <sha>` non-empty) — the self-resolving categories in the remediation doc, no action taken. The remaining **33 dangling** (the doc's 29 plus 4 new ones from the 2026-07-16 work session: construct-4uxq0.9.5 / .11.3 / .13.3 / .13.4, which never had preserve refs) plus the **30 unresolvable** are dispositioned below. `git fetch --all --prune` was run first to rule out staleness for List B.

Dispositions: **(a)** work landed under a rewritten SHA; **(b)** work exists only in the orphaned commit; **(c)** cannot determine.

## Verification method

Each row was checked individually (no pattern-matching closes): `bd show <id>` for the close-reason claim, `git show <sha> --stat` for the preserved commit content (List A only), then a landed-work search over `origin/main` / `origin/staging` (`git log --fixed-strings --grep=<bead-id>`, distinctive-file `git log --diff-filter=A -- <path>`, subject grep). Equivalence evidence, strongest first: `git patch-id --stable` identity between orphan and landing commit; byte-identical file content (`diff <(git show A:f) <(git show B:f)`); per-file hunk patch-id identity inside a multi-bead squash; squash-commit body embedding the orphan's exact commit subject plus matching file stats.

## List A — 33 dangling citations, all disposition (a)

| Bead | Cited SHA | Disp. | Landed as (ref) | Evidence (one line) |
|---|---|---|---|---|
| construct-vzg2i.1 | 86b50b07 | a | c5a7dbec (origin/main) | patch-id identical, same subject naming the bead |
| construct-pteo2.1 | 9a975faf | a | 24c13e9f (origin/main) | patch-id identical; audit doc present under docs/notes/research/ |
| construct-pteo2.2 | 15160751 | a | d2a83150 (origin/main) | patch-id identical, same subject naming the bead |
| construct-95phc.3 | 147678dd | a | f4d65975 (origin/main) | patch-id identical, same subject naming the bead |
| construct-fbxv | dbff3f7d | a | 0116d8f1 (origin/main) | shapeRun hunks for bin/construct present in the multi-bead squash diff |
| construct-trxz.12 | 96a72068 | a | d70dad04 (origin/main) | body names trxz.12; lib/mcp-platform-config.mjs hunk patch-id identical |
| construct-twu9 | d2c0ad8 | a | 59850aa7 (origin/main) | same subject; tests/hooks/no-skip-vars.test.mjs byte-identical |
| construct-o3o6 | e88b2b1 | a | 7df8a7bf (origin/main) | patch-id identical, same subject |
| construct-r53 | 8fb5791 | a* | 4735d98d (origin/main) | cited commit is a mis-citation (intake commit, bd: construct-fkh5) — see note below |
| construct-bky | 8fb5791 | a* | 4735d98d (origin/main) | cited commit is a mis-citation (no mcp-manager changes) — see note below |
| construct-w9pp | fd5ed52 | a | 4c7b88fe (origin/main, PR #242) | PR body embeds exact subject; lib/reconcile/* files in stat |
| construct-n6h7 | 847970b | a | 4c7b88fe (origin/main, PR #242) | PR body embeds full 'fix(init): non-destructive host footprint' message |
| construct-7e2o | bc85ba9 | a | 4c7b88fe (origin/main, PR #242) | PR body embeds subject; lib/agent-instructions/inject.mjs (94 lines) in stat |
| construct-81dk | 847970b | a | 4c7b88fe (origin/main, PR #242) | PR body embeds message incl. install machine-state-only boundary |
| construct-dhfz | 847970b | a | 4c7b88fe (origin/main, PR #242) | PR body embeds message incl. zero-commit init / --commit-bootstrap |
| construct-jlql | 847970b | a | 4c7b88fe (origin/main, PR #242) | PR body embeds message incl. gitignore coverage; lib/host-disposition.mjs in stat |
| construct-jsut | 847970b | a | 4c7b88fe + ec0c0940 (origin/main) | PR body embeds all five wave-commit subjects; ADR-0027 doc in ec0c0940 |
| construct-e13x | 847970b | a | 4c7b88fe (origin/main, PR #242) | PR body embeds message incl. construct.config.json scaffold |
| construct-0uga | 847970b | a | 4c7b88fe (origin/main, PR #242) | init-output cleanup rode the lib/init-unified.mjs rewrite in the same squash |
| construct-6xo0 | 847970b | a | 4c7b88fe (origin/main, PR #242) | knowledge-layout.md disposition fix carried in the same squash |
| construct-4xy6 | bc85ba9 | a | 4c7b88fe (origin/main, PR #242) | PR body embeds host-aware adapter-selection subject + flags |
| construct-73su | 9ca4449 | a | 4c7b88fe (origin/main, PR #242) | PR body embeds uninstall-coverage subject; uninstall.mjs +187 matches |
| construct-lb7b | a875e40 | a | 4c7b88fe (origin/main, PR #242) | PR body embeds per-home namespace subject; lib/home-namespace.mjs (60) matches |
| construct-hfek | 0d0cd616 | a | 468b5fcf (origin/main) | body names hfek; fake-pg-queue-sql.mjs Bin 11190 + same pg-queue deltas |
| construct-shtp | dfbdb300 | a | 468b5fcf (origin/main) | body names shtp; doc-intake-approval test +49 matches orphan stat |
| construct-qulg | 00ecd914 | a | 468b5fcf (origin/main) | body names qulg; ingest-tooling test +120 matches orphan stat |
| construct-aduf | 872dab32 | a | 468b5fcf (origin/main) | body names aduf; deck-export test +5 matches orphan stat |
| construct-73n5 | ead94e94 | a | 468b5fcf (origin/main) | body names 73n5; self-hosting-cert test +13 matches orphan stat |
| construct-azli | 5616a697 | a | 468b5fcf (origin/main) | body names azli; project-root-isolation test +44 matches orphan stat |
| construct-4uxq0.9.5 | ab321f86 | a | 12f7591d (origin/feat/wjap9-p1.2-graph-vocabulary) | patch-id identical, same subject naming the bead |
| construct-4uxq0.11.3 | 87caf351 | a | 6cac70b7 (origin/feat/wjap9-p1.2-graph-vocabulary) | patch-id identical, same subject |
| construct-4uxq0.13.3 | 8bbae5b8 | a | 06f7a1c3 (origin/feat/wjap9-p1.2-graph-vocabulary) | all five key files byte-identical between the two commits |
| construct-4uxq0.13.4 | 22dfd7a8 | a | 3ee75384 (origin/feat/wjap9-p1.2-graph-vocabulary) | worker-pg-queue-integration test byte-identical |

**a\* (mis-citations, construct-r53 and construct-bky):** both cite 8fb5791, whose content is the intake classifier/quarantine commit (`bd: construct-fkh5` in its own message) — it contains neither the pre-push-gate fix r53 claims nor the mcp-manager test fix bky claims. The cited commit object itself is on origin/main as 4735d98d (patch-id identical), so the preserve ref was safe to delete. Each bead's underlying issue is independently verifiable as resolved on origin/main: r53's npm-test-from-hook path no longer exists (`lib/hooks/pre-push-gate.mjs` rewritten in 59850aa7 to run no test/build/lint); bky's `tests/mcp-manager.test.mjs` uses mkdtempSync + rmSync cleanup for its construct-atlassian-* dirs (lines 16-19, 374-375 at origin/main). Both left closed with the mis-citation recorded in a bd note.

## List B — 30 unresolvable citations, all disposition (a)

None of the 30 tokens resolve after `git fetch --all --prune` (`git rev-parse --verify <sha>^{commit}` fails). All 30 beads were closed between 2026-05-12 and 2026-05-14; their close reasons name branch `feat/algorithmic-infrastructure` (or, for the 2026-05-12 pair, the same pre-squash workflow). That branch does not exist on origin, and origin/main carries squash-merge PRs whose bodies embed the branch's individual commit subjects — the cited SHAs were branch-local commits whose objects were never pushed to (or were pruned from) this clone. The evidence supports orphaned-by-squash-merge, not fabrication: every close-reason claim maps to a named subject line inside a landing commit and to files verifiable on origin/main.

Primary landing commits: **b3277fca** (`Algorithmic infrastructure: dashboard, observability, billing, hooks audit (#47)`, 2026-05-15, 163 files / +15414, body lists ~50 branch-commit subjects), **7f0dcaae** (`feat: enforcement hardening + retrieval CI fix (#24)`, 2026-05-12), **9fc58e89** (PR #39).

| Bead | Cited SHA | Disp. | Landed as (origin/main) | Evidence (one line) |
|---|---|---|---|---|
| construct-2t7 | 5c2b756 | a | 7f0dcaae (#24) | subject matches the close reason's claim set verbatim |
| construct-b5c | 5c2b756 | a | 7f0dcaae (#24) | lib/parity.mjs +25 in stat; `git log -S codex` shows #24 added the Codex surface |
| construct-c39 | a1e2524 | a | b3277fca (#47) | body: 'feat(config): deployment modes...'; lib/deployment-mode.mjs first added by #47 |
| construct-c99 | 0acf315 | a | b3277fca (#47) | body: 'feat(intake): R&D triage classification...'; lib/intake/classify.mjs first added by #47 |
| construct-ddq | e286163 | a | b3277fca (#47) | body: 'feat(intake): wire construct intake list/show/done/skip/reopen' |
| construct-7gs | 27a9d9b | a | b3277fca (#47) | body: IntakeQueue interface + filesystem adapter; file first added by #47 |
| construct-8v1 | db8148f | a | b3277fca (#47) | body: postgres queue row-locked claims; postgres-queue.mjs + 003_intake.sql first added by #47 |
| construct-c0r | 69c8982 | a | b3277fca (#47) | body: role-aware context router; lib/context-router.mjs first added by #47 |
| construct-y1l | 388d72d | a | b3277fca (#47) | body: task graph schema/generation/store; lib/task-graph/schema.mjs first added by #47 |
| construct-mu2 | 39a480d | a | b3277fca (#47) | body: bounded execution + trace + evidence; lib/worker/run.mjs first added by #47 |
| construct-gox | d032a3a | a | b3277fca (#47) | body: hybrid fusion scoring + benchmarks; lib/storage/fusion.mjs first added by #47 |
| construct-b8p | b554bd3 | a | b3277fca (#47) | body: mcp broker + policy engine; lib/policy/engine.mjs + lib/mcp/broker.mjs first added by #47 |
| construct-b4d | 5227eb0 | a | b3277fca (#47) | body: orchestration_policy per-specialist context packets |
| construct-th6 | 0fc1507 | a | b3277fca (#47) | body: broker_check mcp tool for pre-action policy queries |
| construct-dq9 | cee2013 | a | b3277fca (#47) | body: orchestration_policy auto-generates task graph from intakeId |
| construct-9em | ef59831 | a | b3277fca (#47) | body: worker_run mcp tool with task-graph evidence linkage |
| construct-8yo | 5227eb0 | a | b3277fca (#47) | epic — all four sub-bead subjects (b4d/th6/dq9/9em) in body |
| construct-9aj | fef4e77 | a | b3277fca (#47) | body: hard binary postconditions; lib/agents/postconditions.mjs first added by #47 |
| construct-9dx | b2645b5 | a | b3277fca (#47) | body: docker image + compose + worker entrypoint loop; Dockerfile.worker first added by #47 |
| construct-heo | 92b28df | a | 9fc58e89 (#39) + b3277fca (#47) | stage-project stages .construct/; distribution bootstrap shims on origin/main |
| construct-gi7 | 92b28df | a | 9fc58e89 (#39) + b3277fca (#47) | postinstall -> stageProjectAdapters path the close reason names is on origin/main |
| construct-6ae | 519962b | a | b3277fca (#47) | body: cache-token underbilling fix + live pricing catalog — the close reason's two claims |
| construct-81q | 36ed16b | a | b3277fca (#47) | body: langfuse magic-link bridge; langfuse-login.mjs on main until 2026-06-25 dashboard deletion |
| construct-rm6 | cc45f15 | a | b3277fca (#47) | body: 'doctor probes cm+docker...' (probes later removed in the June Docker pivot) |
| construct-jml | cc45f15 | a | b3277fca (#47) | body: '...auto-start docker...'; tryStartDockerDaemon in main history until the Docker pivot |
| construct-7g2 | cc45f15 | a | b3277fca (#47) | body: '...fix langfuse undefined note'; isRemoteLangfuseUrl entered main at 83317182 (#43) |
| construct-4zk | cc45f15 | a | b3277fca (#47) | validation bead; every validated surface is in #47's stat/body |
| construct-jj3 | 3ff5cdc | a | b3277fca (#47) | body: cross-platform intake + broker prelude; session-prelude.mjs first added by #47 |
| construct-5vd | 3f4c035 | a | b3277fca (#47) | body: live insights panel; insights.mjs first added by #47 (deleted 2026-06-25, post-close supersession) |
| construct-0wv | e225caf | a | b3277fca (#47) | body: handoffs retention + prune + doctor; handoffsMaxDays at lib/config/schema.mjs:105 today |

## Counts

| List | (a) landed rewritten | (b) orphan-only | (c) undetermined | Total |
|---|---|---|---|---|
| A (dangling, local object) | 33 (2 with mis-citation caveat) | 0 | 0 | 33 |
| B (unresolvable token) | 30 | 0 | 0 | 30 |

- **Beads reopened: none.** Every bead's claimed work was found on a live pushed ref; no acceptance criteria are unmet.
- **Preserve refs: all 29 deleted, 0 kept** (`git for-each-ref refs/preserve` now returns nothing). Every preserved object's content is reachable on origin/main or origin/feat/wjap9-p1.2-graph-vocabulary under its rewritten SHA. The 4 new July-16 dangling citations never had preserve refs and need none (content is on the pushed feature branch).
- Each of the 63 beads carries a `bd note` beginning `SHA reconciliation (construct-4uxq0.16):` with its per-bead evidence.

## Residual invariant state

After this pass the invariant still reports the 33 List-A entries as `failed` and the 30 List-B entries as `unknown` when run against `origin/main` alone — the annotations live in bd notes, and 4 of the landings are on an unmerged feature branch. The 36 branch-reachable violations self-resolve on merge, as the remediation doc already records. Whether the invariant should read reconciliation notes as an "unmerged annotation" is a design question for the coordinator, not something this pass changed.

## Systemic root causes

1. **Squash-merge and rebase-before-merge orphan every close-time SHA.** All 63 citations trace to the same workflow: work committed on a branch (agent worktree, feature branch, or integration branch), bead closed citing the branch-local SHA, branch then squash-merged or rebased and deleted. Clusters: PR #242 (13 beads, 2026-06-05 ADR-0027 wave), PR #47 b3277fca (26 beads, 2026-05-12/14 algorithmic-infrastructure), 468b5fcf (6 beads, 2026-07-05 test-hygiene wave), 0116d8f1 / d70dad04 (2 beads, 2026-07-05), plus per-commit rebases (July 9 and July 16 sessions).
2. **The multi-bead squash body is what makes reconciliation possible.** Every recovered mapping leaned on the squash commit preserving its constituent subjects in the body. Squashes that drop the constituent messages would have turned these (a) rows into (c).
3. **Two genuine mis-citations exist (r53, bky)** — both wrote the session's most recent commit SHA into the close reason instead of the commit that carried the fix. Both underlying fixes are real; only the citation is wrong.
4. **No evidence of fabricated citations.** Every List-B token, despite resolving to nothing, mapped to a real landed subject line.
