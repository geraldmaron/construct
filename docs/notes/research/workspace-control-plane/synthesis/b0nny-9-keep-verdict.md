---
intake: none
---

# Keep-verdict: `lib/scheduler/` (construct-b0nny.9)

Verified 2026-07-17 against the worktree at `chore/b0nny.9-scheduler-removal`
(forked from `feat/workspace-control-plane` at `adeff6d9`). Outcome: **keep, not
orphaned.** The truth-map's "only a mutual import with `lib/hygiene/scan.mjs`"
claim (`execution-surfaces-truth-map.md` §2, line 34-37; `consolidated-findings.md`
X4) undercounts the real dependents — it appears to reflect a static-import grep
scoped to `lib/`, which misses `bin/construct`'s dynamic imports and the CLI
command registry.

## Evidence that blocks removal

1. **Live, documented CLI command.** `bin/construct:6461` dynamically imports
   `runJobOnce, listJobs` from `../lib/scheduler/index.mjs` inside `cmdScheduler`,
   which is registered in the command dispatch table at `bin/construct:7251`
   (`['scheduler', cmdScheduler]`) and described as a first-class command in the
   CLI registry at `lib/cli-commands.mjs:1179-1186` (category `Advanced`,
   `usage: 'construct scheduler <list|run|runner>'`). Ran it directly against this
   worktree: `node bin/construct scheduler list` returns the 4 real registered
   jobs (`tag-candidate-mining`, `skill-usage-rollup`, `doc-hygiene-scan`,
   `optimize-loop`) — this is working production code, not aspirational wiring.

2. **Direct test coverage, 4 files, all passing.** `grep -rn "lib/scheduler"` across
   the repo (excluding `lib/scheduler/` itself) turns up:
   - `tests/scheduler-optimize-job.test.mjs:15` — imports `listJobs, optimizeJobArgv,
     OPTIMIZE_JOB_ID` from `../lib/scheduler/index.mjs`
   - `tests/scheduler-doc-hygiene.test.mjs:19` — imports `resolveDocHygieneSchedule`
   - `tests/functional/agentic-hq-integration.functional.test.mjs:174,183` —
     dynamically imports `listJobs` and `runJobOnce`, exercises the real
     `doc-hygiene-scan` job end-to-end against a fixture home
   - `tests/functional/deployment-mode-single-resolver.functional.test.mjs:21` —
     imports `resolveDocHygieneSchedule` as one of four surfaces asserted to
     agree on deployment-mode resolution (broker, session prelude, scheduler,
     config schema)

   Ran `tests/scheduler-optimize-job.test.mjs` and `tests/scheduler-doc-hygiene.test.mjs`
   directly: 18/18 assertions pass (7 of them specific to `lib/scheduler/index.mjs`:
   5 deployment-schedule-resolution cases + "the optimize loop is registered as a
   scheduled job" + "the scheduled optimize argv never auto-applies").

3. **Load-bearing in a proposed ADR.** `docs/decisions/adr/0077-prompt-optimization-auto-apply-tier.md`
   (status: proposed, 2026-07-11) names `lib/scheduler/index.mjs`'s `optimize-loop`
   job's `--apply` throw as one of three deliberately-enforced human-gates on
   automated prompt mutation ("the human gate on prompt mutation is not an
   oversight; it is enforced deliberately in three separate places already:
   `lib/scheduler/index.mjs`'s `optimize-loop` job throws if its argv ever
   carries `--apply`..." — line 14) and lists the file as a canonical reference
   (line 60). Deleting the module would invalidate a currently-proposed
   architectural decision's stated safety model.

## Correction to the "mutual import" premise

The truth-map's mutual-import claim does not hold up under direct inspection
either: `lib/hygiene/scan.mjs` has no import of `lib/scheduler` at all (only a
file-header comment mentioning it, `lib/hygiene/scan.mjs:12`); the actual
relationship is one-directional — `lib/scheduler/index.mjs:111` dynamically
imports `../hygiene/scan.mjs` inside the `doc-hygiene-scan` job handler.

## Installed-artifact risk: checked, not currently applicable

`lib/scheduler/solo.mjs` exports `registerNativeTrigger` / `removeNativeTrigger`
(launchd plist / systemd timer+service writers, matching the bead's stated
concern). Grepped the whole repo for both names: the only occurrences are their
own `export function` definitions in `solo.mjs:145` and `solo.mjs:165` — zero
callers anywhere, including `cmdScheduler` itself (which only lists/runs jobs
in-process; the `runner` subcommand prints a message and does not call
`registerNativeTrigger`). No `construct init`/`construct sync`/setup code path
references `scheduler` (checked `lib/setup.mjs`, `bin/construct-postinstall.mjs`,
`lib/init-unified.mjs`). Grepped for `LaunchAgents|systemd|launchd|plist` outside
`lib/scheduler/`: matches are in unrelated subsystems (`lib/embed/daemon.mjs`,
`lib/embed/supervision.mjs`, `lib/runtime-pressure.mjs`, `lib/install/legacy-global-cleanup.mjs`,
`lib/uninstall/uninstall.mjs`, `lib/engine/consolidate.mjs`) — none of them
reference `lib/scheduler`. Conclusion: as the code stands today, no user machine
can have an installed launchd/systemd artifact that traces back to
`lib/scheduler/solo.mjs`, because nothing currently calls the functions that
would write one. This means the bead's specific "stranded native OS job" risk
is not realized today — but it is a separate, narrower observation from the
orphan question, and does not change the keep verdict: `index.mjs` has real
callers regardless of whether `solo.mjs`'s trigger writers are wired up.

Note as a secondary, out-of-scope finding: `registerNativeTrigger` /
`removeNativeTrigger` are themselves dead code (defined, exported, never
called) — a future bead could either wire them into a `construct scheduler
install|uninstall` subcommand or remove them from `solo.mjs`. Left untouched
here since this bead's scope is the removal question for `lib/scheduler/` as a
whole, and the module is not being removed.

## Disposition

No files deleted. No importer changes. `docs/notes/research/workspace-control-plane/synthesis/consolidated-findings.md`
X4 row updated to point here with the resolved status.
