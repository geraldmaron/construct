# Source activation and CLI output verification

Recorded 2026-10-14. Work is isolated on `codex/source-activation-cli`.
The tested checkout and installed command report `3.0.0-alpha.28`.
The original report came from another project on another device; its version
and exact state remain unknown. This reproduces the reported mechanism locally,
not a claim to have inspected that device.

## Diagnosis

Reproduction
- Command: in a sterile initialized project, run `construct source add old --kind=directory --purpose=docs --locator=.`, `construct source retire old`, repeat the add, then `construct source add new --kind=directory --purpose=docs --locator=.` and `construct source list --json`.
- Environment: alpha.28 checkout; Node v25.9.0; isolated HOME and project from the existing CLI harness.
- Data: a retired source ID followed by a new, distinct source ID.
- Frequency: deterministic.
- Observed: both adds exit with `source old was retired; declare it under a new id`; the file contains old and new, but the list returns `[]`.
- Expected: the rejected add leaves the declaration file unchanged; the distinct source activates.

Hypothesis: declaration persistence runs before registry validation, leaving a retired ID that aborts subsequent synchronization.
Refuted by: the failed add leaving the file unchanged, or the subsequent distinct ID activating despite the retired entry.
Test: CLI capture showed both entries persisted and neither active. The source service throws inside its database transaction; the CLI wrote the file first.
Verdict: supported. No alternative hypotheses were claimed or silently discarded.

Cause
- Statement: file replacement precedes transactional registry synchronization, so rejected declarations survive and poison later synchronization.
- Evidence: `src/cli/source.ts` and `src/kernel/source/service.ts`; regression tests in `tests/cli/source-activation.test.ts`.
- Accounts for: the retired warning comes from the existing identity guard; the appended entries come from the earlier file write; missing activation comes from the registry transaction rollback.
- Unexplained: the exact triggering actions and version on the other device are unavailable.
- Confidence: high for the local mechanism; correspondence with the remote test remains unconfirmed.

History inspection found the ordering already present in commit `27b010b7`
(2026-09-02); this is not evidence of a newly introduced alpha.28 regression.
Search covered all `syncDeclarations` calls, retired-ID errors, source-service
regressions, CLI add/retire/init, and the broker's existing retired-ID check.

## Change and challenge

Add and retire synchronize inside an outer database transaction before replacing
the file. A file-write failure rolls back source activation. Retired entries
already stranded in the file can be removed with `construct source retire <id>`;
remaining valid declarations then synchronize, including previously stranded new
sources. The retired ID remains retired and its evidence history survives.
The error identifies the blocking ID and gives a recovery command.

Strongest failure mode of automatic revival: new content acquires an old source
identity and its historical evidence. Alternative: revive every retired ID found
in the file. Rejected. Preserve the identity guard and repair persistence instead.
The filesystem and SQLite are not a distributed transaction: a process crash or
commit failure after rename can still leave a mismatch. This patch does not
claim crash atomicity. Accepted with controls: validate first, use the existing
atomic file replacement, and roll back registry changes on ordinary write errors.
No schema, dependency, host-wiring, source-reader, or JSON output contract changes.

## CLI presentation

Existing `say`, `esc`, and `shellWord` in `src/cli/output.ts` are reused. Searches
covered this repository, sibling projects, and installed skills for output and
terminal helpers; no additional presentation library or reusable helper was added.

Sources group attention first, unchecked next, then successful reads, sorting IDs
within groups. A successful read without a freshness policy is not called fresh.
Add reports actual activation/reachability/freshness; refresh announces the read.
Doctor reports overall status first, then failures and passing checks sorted by name.
Status separates setup, work/decisions, sources/registry, sessions and recent activity.
Inbox separates decisions from proposals. Work and run lists group by state with
attention first, preserving recency within groups and retaining all enum states.
Run details count succeeded steps without inventing a time estimate.
JSON shapes, ordering and exit codes remain unchanged. Unmodified command surfaces
retain their existing output; this is not a replacement terminal framework.

## Verification

Outcome: a rejected retired ID cannot block a subsequent valid source addition;
people see source status, actionable failures, grouped lists and truthful progress.
Surface: the actual `bin/construct.mjs` executable in a sterile project, in addition
to the existing CLI harness and packaged-install smoke.
Data: project documents, two directory sources, an unavailable Jira source,
a retired source, a workflow with pending steps, proposed work and inbox items.
Observed: new sources report active; refresh reports changed or unreachable;
source lists place failures before unchecked and read sources; retired-ID rejection
reports that declarations were unchanged. Run show reports `0 of 4 steps succeeded`.
Empty lists, populated lists, failure output and JSON were inspected as terminal text.
No browser or graphical surface is involved.

Negative control: restoring the original source CLI makes both activation/recovery
regressions fail. Restoring the patch passes all three source regressions. The third
forces a real filesystem write failure and checks both file and registry state.

Check: source regression and negative control
Command: `node --test tests/cli/source-activation.test.ts`
Result: pass with the patch; fail with the original source CLI.
Observed: rejected adds preserve bytes, subsequent sources activate, stranded declarations recover, failed file writes leave no active source.

Check: full repository gate
Command: `npm run lint && npm run typecheck && npm test && npm run smoke`
Result: pass on the final candidate.
Observed: final suite passed 1080 tests, skipped one; packaged smoke printed `smoke-packaged-install: pass`.

## Verification record

- Project inspected: answered above, “No schema, dependency, host-wiring, source-reader, or JSON output contract changes.”
- Reuse checked: answered above, “Existing `say`, `esc`, and `shellWord` ... are reused.”
- Validation path run: answered above, “pass on the final candidate”.
- Outcome observed: answered above, “new sources report active”.
- Surface inspected: answered above, “Empty lists, populated lists, failure output and JSON were inspected as terminal text.”
- Diff reviewed: source-consistency staged diff inspected in full; presentation diff inspected against grouped-status and unchanged-JSON acceptance. No credentials or unrelated project changes included.
- Residual risk: remote test version/state unknown; filesystem/database crash atomicity not established; merge overlap with the concurrent main-checkout documentation session requires reconciliation before landing.
- Root-cause-debugging: local reproduction, full error, historical ordering, falsifiable hypothesis, whole local symptom, negative control and regression coverage recorded; measurement gate not applicable.
