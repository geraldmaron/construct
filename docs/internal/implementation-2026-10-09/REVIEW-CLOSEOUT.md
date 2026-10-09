# Independent review follow-up

Status: implementation and bounded replays pass; independent recheck clearance remains pending. Do not interpret this file as review clearance.

## Measured coverage

The saved conformance report has 91 passed checks and seven untested **cells**. Precisely: six live-host calls (Claude Code, Cursor, VS Code, OpenCode, Codex and Bob), plus Bob installation, because Bob is absent. Earlier wording calling all seven “live-host cells” was imprecise. [Exact report](evidence/conformance-final.json).

Separate from that static report, fresh native Codex CLI consumers exercised ordinary question handling, specialist authoring, unrelated archive research, controlled source discovery/denial and source correction. The bounded **Codex executor adapter** exercised execution after the originating process exited, duplicate occurrence handling, startup interruption/resumption and requested local file delivery. This is actual Codex adapter coverage. It does not mark the separate conformance live cells passed, qualify the other hosts, provision arbitrary external connectors, install a clock, or prove semantic correctness.

## Cleanup

The implementation run `run-7b6676b3` succeeded. Its earlier control sessions are ended and original claims were released. The initial final cleanup found no owned fixture/control processes or pending signing process. One stale session row from the original, confirmed-dead control process was closed with the native session API after checking that it held no claims. The new review-follow-up control session and `work-f690a2b6` are active only while this follow-up is completed. Reproduction fixtures, package bytes and evidence are retained; unrelated processes and work are untouched.

## Signed local commits

The configured values remain `gpg.format=ssh`, `commit.gpgsign=true`, and the 1Password `op-ssh-sign` program. No signing process is pending. Three normal attempts failed; the latest returned `error: 1Password: failed to fill whole buffer` and `fatal: failed to write commit object`. The precise cause is not established, and no signing or security setting was changed.

Supported user-assisted retry: open and unlock the 1Password desktop app; retry the normal signed local commit; approve the resulting SSH-key signing prompt using the normal unlock method, such as Touch ID. There is no currently pending prompt that this task can confirm. If the same error returns after authorization, preserve the index and working files and diagnose the signer instead of disabling signing. [Official signing authorization flow](https://www.1password.dev/ssh/git-commit-signing).

The staged research slice can be inspected with `git diff --cached`; its pending commit subject is `Account for bounded research references and coverage`. Existing local commits remain `6febaa30` and `d798abcc`. No push, merge or release is authorized.

## Review findings in progress

- P1: occurrence keys and overlap leaked across independent triggers using one workflow. Fix uses `(trigger_id, idempotency_key)`, scopes run identity and overlap to the trigger, and serializes queued firings without blocking unrelated intents. State format 5 explicitly migrates old firing history.
- P1: required `run_tests` did not gate step/run success. Public submission now rejects missing, failed, stale and wrong-attempt command receipts before completion; the fire CLI rechecks terminal rows, including legacy rows. Inspection-only workflows retain structural assurance.
- P2: an unchanged reread was tied to old content-snapshot age. Freshness now follows successful per-item observations; omitted/weak items retain their age.
- Validation gap: the previous one-millisecond timeout occurred before work. It does not prove recovery during work; a new actual mid-work interruption trial is required and pending.

## Counterexample recheck checkpoint — 18:36 UTC

The two P1 fixes and unchanged-reread freshness are ready for independent recheck against the uncommitted local tree. [Exact file and package hashes](evidence/review-checkpoint.json). Public submission/CLI negative controls reject missing, failed, stale and wrong-attempt execution receipts; a real successful local command passes. Twenty focused gates and 32 repaired positive journeys pass. The last complete gate passed 861 tests, zero failed, one existing skip, plus lint/typecheck/smoke.

A live non-Git project exposed an executor startup restriction; the explicit adapter now uses Codex's supported `--skip-git-repo-check` while retaining `workspace-write`. The actual interruption trial created a 1,521-byte file and held a do-step lease before termination, then resumed the same run. Its first invalid derivation unexpectedly spent its remaining validation budget because the service counted the prior expired lease. That failure is retained; the fix counts failed checks separately from lease expirations and preserves waiver boundaries. Its 27 service tests pass; a fresh full recovery trial and final complete gates are in progress. West's independent same-key run completed with real command evidence while East was held, proving isolation on this live checkpoint. No semantic or universal host qualification is claimed.

## User-authorized signing preference change

The user explicitly requested removal of the prompt signing requirement. `git config --local commit.gpgsign false` is now applied only to Construct. The effective local value is false; global `commit.gpgsign` remains true and 1Password configuration is unchanged. The earlier signer failures remain historical evidence, not a current blocker. No push, merge or deployment follows from this preference change.

## Final bounded replay — 18:42 UTC

[Actual mid-work recovery](evidence/midwork-retry/assessment.json) passed: existing artifact and do-step lease before termination, same run resumed, completed plan preserved, actual command witness, independent same-key West result, duplicate East with no executor spawned. The prior mid-work failure remains preserved and prompted the retry-budget fix; approval/waiver behavior remains covered by its scenario test. The latest full gate passes **862 tests, zero failures, one existing skip**, plus lint, typecheck and packaged smoke.

[Held-out warehouse evidence](evidence/warehouse/assessment.json) preserves the natural prompt, source reads, full public consumer events, state and actual brief. It correctly keeps the replenishment decision unresolved when the current case conversion and reservation unit are unknown. No external action or permission bypass occurred.

State format 5 was applied using the native supported migration after the owned control session stopped; the [migration receipt](evidence/review-migration.json) names the preserved backup. Broader parent work remains open. New code is ready for independent recheck; full multi-host and semantic qualification remain unproved.
