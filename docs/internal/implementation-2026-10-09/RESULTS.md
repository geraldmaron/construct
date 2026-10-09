# Implementation assessment — 2026-10-09

This follow-through was authorized after the original [intake](../intake-2026-10-09/README.md). It preserves that audit as the historical baseline. The complete native program is `work-18402da5`; not every original acceptance criterion is satisfied yet.

## Verdict

Fresh native Codex installs now demonstrate natural specialist routing, connected source use, durable method accounting and bounded execution after session exit. Shared trust, source and scheduling defects were reproduced and corrected. This is **not** evidence of an autonomously reliable organization-in-a-box across all harnesses or unknown connectors. Release remains blocked by absent full live qualification. Local test success does not authorize publication.

## Contracts and evidence

| Contract | Current implementation and evidence | Remaining limit |
|---|---|---|
| Ordinary questions | Fresh archive policy Q&A created zero runs, steps, deliverables or work items. [Evidence](evidence/archive-qa/score.json). | One native host and one local policy case; no universal semantic guarantee. |
| Intent and specialist routing | Unambiguous typed deliverable aliases; no added product-name or prose keyword classifier. Fresh renamed SSO request selected PRD authoring and completed four steps. [Evidence](evidence/sso-final/assessment.json); [intake](../../../src/kernel/workflow/intake.ts). | The host must load Construct and interpret intent. Missing host integration cannot be repaired by skill prose. |
| Discovery and source uncertainty | Scope-aware observations distinguish read, empty, denied, auth-required, unsupported and unreachable; bounded graph retains missing links and dispositions. [source service](../../../src/kernel/source/service.ts), [research](../../../src/kernel/source/research.ts). | Host reports are reports. No universal authenticated API/MCP adapter or semantic schema mapper is claimed. |
| Change and revocation | Changed bytes/schema/units invalidate identity even with unchanged timestamps; complete weak sightings preserve strong reads; partial refresh cannot freshen unread items; revoked reads block cache resolution. [manifest](../../../src/kernel/source/manifest.ts), [resolver](../../../src/kernel/source/resolver.ts). | Historical full snapshot text is not always supplied to the model; the live drift runner honestly could not describe the prior field-level delta. |
| Capability and permissions | Generic host source grants cannot satisfy connector-specific requirements; observations do not widen permissions; clock CLI is headless. [capabilities](../../../src/kernel/registry/capability-registry.ts), [host binding](../../../src/cli/broker-context.ts). | Interactive host capabilities remain declarations; provider principal/expiry and all actual connector probes are not universally implemented. |
| Method selection/composition | Default bodies, durable assignments and separate applied/skipped/deferred reports bind method version/digest and evidence. [methods](../../../src/kernel/workflow/methods.ts). | Reports do not prove qualified application. Skills remain experimental without a qualifying executed record. |
| Verification and completion | Host CLI observes actual argv/exit/timeout and artifact hashes. Wrong command, attempt, content, missing or failed receipt cannot confer tested validation or acceptance. Final destination check requires the requested local file. [verification](../../../src/kernel/workflow/verification.ts), [command adapter](../../../src/hosts/verification.ts), [workflow](../../../src/kernel/workflow/service.ts). | A command can be insufficient. Structural and executed-command assurance do not establish semantic entailment. The final fresh scheduled-file replay passed; file presence and digest were inspected. |
| Persistence integrity | Finding/lesson/decision ID claims must resolve to native records. Report-only inspection cannot complete a workflow step that requires tests. | Review content can be durably stored without separate admitted lessons or graph findings; this is stated explicitly. |
| Standing intent | `maintain` saves an idempotent trigger, preserves original intent/source/destination/stakes, starts zero immediate runs, and reports unprovisioned clock/executor. Relative `today` resolves per firing. [scheduling](../../../src/kernel/workflow/scheduling.ts), [triggers](../../../src/kernel/workflow/triggers.ts). | No daemon or clock is installed. Event senders and persistent state must be provisioned explicitly. |
| Actual executor | Codex adapter probes installed authenticated CLI, runs one bounded invocation in the host sandbox, checks durable state, and fences its abandoned leases. Actual mid-work interruption resumed the same run, retained its completed plan, and produced a real brief and command receipt. Independent same-key schedules produced distinct results; a duplicate spawned no executor. [evidence](evidence/midwork-retry/assessment.json), [adapter](../../../src/hosts/executors.ts). | Only Codex has this adapter; all other interactive hosts explicitly report unattended execution unprovisioned. External connectors are not provisioned by it. |
| Release claims | Release CI now invokes the existing full live-intake gate; evidence identity includes runtime/invocation and dependency bytes as well as model-facing text. [release job](../../../.github/workflows/release.yml), [evaluator](../../../scripts/evals-live.mjs). | The record is absent, so the dry-run fails. The canonical corpus still needs complete artifact, source-change and after-exit acceptance coverage, beyond routing. |

## Adversarial results

The trials found real false-positive completion paths: unsupported PRD routing, skipped material references, source corrections hidden by timestamps, permission aliasing, partial-read freshness, structured artifact paths escaping receipt checks, reported tests called validated, invented native record IDs, and a completed scheduled review that did not create its requested file. Failed runs remain in evidence rather than being relabeled as successes. Fixes target shared contracts; fixture names are not production conditions.

The archive brief, renamed SSO PRD, post-exit corrected-schema review, and interrupted managed outcome have distinct domains or execution shapes. They are useful counterexamples and repeatability checks, not a statistical quality certificate. Prompt injection and inaccessible content remain untrusted evidence; no external send, release or deployment occurred.

The independent review additionally reproduced cross-trigger key/overlap collisions, missing execution gates and stale identical rereads. These are fixed with trigger-scoped state-format-5 uniqueness, pre-completion execution enforcement and observation-based freshness. The meaningful recovery test found a separate expired-lease retry-accounting defect; recovery now preserves the validation budget while keeping human waiver boundaries. [Review closeout](REVIEW-CLOSEOUT.md).

A new [warehouse trial](evidence/warehouse/assessment.json) used local policy plus unfamiliar MCP sources. The [actual brief](evidence/warehouse/warehouse-brief.md) favored corrected case-based data over a same-timestamp cache and held the decision on unknown conversion and reservation units, including denied supplier terms. This is a bounded held-out example, not domain expertise qualification.

## Architecture boundary

Keep intent admission, evidence identity/provenance, scoped policy, leases, frozen work, dependency invalidation and trust transitions in the kernel. Keep source access, host tool inventory, credential probes, actual commands, model execution and clocks in explicit adapters. Method bodies remain portable guidance with versioned bindings and honest application records. Do not embed a second model loop or pretend a cron expression executes a model. The explicit Codex handoff uses its documented [non-interactive host interface](https://learn.chatgpt.com/docs/non-interactive-mode); support for another host requires its own exercised contract.

## Validation and blockers

Current gate: lint, typecheck, **862 passing tests, zero failures, one existing skip**, packaged smoke; **91 passed, zero failed, seven untested cells (six live calls plus absent Bob installation)** in the saved [all-host report](evidence/review-conformance.log). The new destination guard passed both unit and public-broker negative tests. The latest ordinary scheduled-file replay passed after its originating session exited: [assessment](evidence/schedule-artifact/assessment.json), [actual brief](evidence/schedule-artifact/release-brief.md). The source-drift and interrupted managed executor evidence used packed alpha.26 hash `51109874e0646a03235c0593a861081a6c6ea683a8d8c02f8fbbb708f6014ac3`; later safety/destination changes are covered by the newest full gate and the final destination replay, using package `691f73a7188c57ce1f6b16b60ddfa9ac626850d90b4acae87aaa9ce917662822`.

The user explicitly removed Construct's signing-prompt requirement. Repository-local `commit.gpgsign=false` is applied; the global value remains true and 1Password settings are unchanged. The previously blocked research commit succeeded as `58146ab5`. Earlier commits are `6febaa30` and `d798abcc`. No push, merge, publish or deploy occurred. The user's memory files were not modified.

Remaining work and exact acceptance tests are still in [BACKLOG.md](../intake-2026-10-09/BACKLOG.md), especially complete scoped capability probes, semantic schema interpretation, old-context retrieval, executed skill qualification and a full live release matrix. The original [validation plan](../intake-2026-10-09/VALIDATION.md) remains applicable. No unmeasured host or absent production clock is counted as working.

## Native handoff

The original intake is complete. The native parent outcome remains open because the broader capability, source, context, semantic-support, skill-qualification and release-matrix criteria are not all met. The executed-verification item and bounded executor/standing-intake children are complete with their actual evidence. Partial items retain their original acceptance criteria and precise remaining work; local state is available through Construct’s native work ledger. This implementation run records the bounded changes and their verification, rather than declaring the entire product promise complete.


## Latest review checkpoint

The independent counterexample fixes, format-5 migration, held-out warehouse artifact and actual mid-work recovery are saved under [REVIEW-CLOSEOUT.md](REVIEW-CLOSEOUT.md). Latest complete gate evidence is [tests](evidence/review-final-tests.log), [lint](evidence/review-final-lint.log), [types](evidence/review-final-typecheck.log), and [packaged smoke](evidence/review-final-smoke.log). Independent recheck clearance remains pending; do not infer it from these implementation tests. Older package hashes and failure trials above remain historical evidence.


Local code checkpoint: `2b1720e0` (implementation and regression tests), following `58146ab5` (bounded reference research). [Exact final file hashes](evidence/review-final-checkpoint.json). The review implementation run `run-0a70f6ba` has an actual [current-lease command witness](evidence/review-native-verification.json); it does not complete the broader parent outcome. Independent recheck is still pending.


Final [cleanup audit](evidence/review-cleanup-final.json): owned control sessions ended, no fixture or signing processes remain, and all owned work claims are released. The bounded native run succeeded; `work-f690a2b6` remains open solely for independent review clearance. The [handoff record](evidence/review-handoff.json) records exact signing scope and unchanged broader limits.
