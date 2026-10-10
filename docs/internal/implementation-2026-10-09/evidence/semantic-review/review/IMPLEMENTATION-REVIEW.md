# Independent semantic gate implementation review

Read-only review of the uncommitted implementation on 2026-10-09. No repository files were edited and no model was launched. The repo changed during this review as the implementing agent addressed findings. The isolated snapshot and probes preserve the versions on which the findings were reproduced; this is not a claim that every original finding remains in the latest checkout.

Evidence: `implementation-snapshot/tests/kernel/workflow/independent-semantic-review.test.ts`. Eight tests passed: seven defect reproductions and one negative control. The native transport reproduction executes a tiny local fixture script that prints JSON, not a model; it uses a disposable root, synthetic HOME/PATH, no credentials and no network.

## Remaining findings reported to the implementer

### P1 — The producer can substitute a script for the native reviewer through PATH

`src/hosts/semantic-review.ts` selects `findOnPath('codex', input.env)`, then trusts the selected process's self-reported version, subscription status, MCP inventory, session ID and result events. The isolated fake `codex` reports `codex-cli 0.145.0`, `Logged in using ChatGPT`, an empty MCP inventory, and all-pass judgment JSON. `executeSemanticReview` returns `passed:true`; identical final resubmission makes the run succeed. No semantic reviewer ran.

This is a reachable invocation substitution issue, not an argument that a local database owner must be cryptographically distrusted. An ordinary workspace-writing producer can create a PATH-shadowing executable and invoke the allowed review CLI with that PATH. The new comment that no arbitrary command can establish semantic review is therefore stronger than the current transport.

Smallest fix: select the approved host-owned installed executable independently of producer-controlled PATH, and bind its absolute real path/content identity (plus actual native package binary identity for wrappers) to the finite tested adapter profile. Recheck identity at dispatch and receipt as appropriate. Bind the version/profile/configuration actually tested; a different binary or untested version reports unavailable. Do not silently fall back to another executable. This requires no signing change and makes no universal guarantee against arbitrary machine administration.

### P1 — Clarification answers governing producer work are missing from review

`service.ts:inputsFor` appends resolved run answers to `inputs.answers`, and its instructions tell the producer to work to them. `prepareSemanticReview` includes only the original frozen request, candidate, source state and confirmed profile statements. It does not include these resolved answers.

Reproduction: a planning step asks which design is required; a person answers `AUTHORITATIVE_USER_REQUIREMENT_USE_OPTION_B` on `tty_cli`. The final producer packet contains that answer. The final bundle for a candidate choosing option A does not contain it anywhere. The reviewer cannot assess this material amended requirement from the admitted evidence.

Smallest fix: include a bounded projection of relevant resolved run decisions/clarification answers, retaining question, answer, person/relay provenance and stable identity. Bind this projection into bundle digest and freshness checks. Keep approval for a later action distinct from instructions for the current assessment.

### P2 — Oversized packets lose the promised preserved draft

`prepareSemanticReview` throws when canonical bundle size exceeds 512 KiB, before `pendingSemanticReview` calls `upsertDraft`. A 600,000-character inline final body leaves the lease active but creates no deliverable and returns only an exception. The candidate is not preserved as the surrounding API promises.

The size refusal is correct and fail-closed. Preserve the exact candidate draft before returning an explicit unsupported-size review state, or catch a typed preparation-size result and save a draft with a clear repair path. Do not truncate evidence or quietly relax the cap. Ensure an older pending draft cannot remain presented as the latest candidate after this failure.

### P2 — Raw stream bounds and malformed-event handling are incomplete

The host counts bytes only after `readline` emits a complete line and after private-event filtering. A large `thinking` event never counts against the cap. An unterminated JSON line can accumulate in `readline` without counting at all. Stderr is counted after redaction rather than by raw bytes. Count raw stdout/stderr chunks before parsing or filtering, terminate at the bounded limit, and separately retain only public projections.

`JSON.parse('null')` succeeds, then `event.type` throws outside the parse catch. Validate non-null object envelopes before access. Completion is also a boolean and agent messages overwrite a variable; duplicate terminal events or final text after an earlier terminal event are not rejected. Require an ordered session/final/terminal contract. These are direct code findings; this pass did not launch a malicious native worker to test them.

## Earlier reproduced findings being fixed during review

The implementing agent confirmed the following and began fixes. The latest source inspection shows the described changes; the isolated tests intentionally retain the old behavior and are not post-fix verification.

| Reproduced defect | Exact observation | Fix observed or announced |
| --- | --- | --- |
| P1: a final-body review unlocks another deliverable | An earlier challenge deliverable containing `UNREVIEWED_OLDER_BODY` is absent from the final bundle, yet can be promoted through challenged → accepted → final once another final body passes. | Promotion now checks that the promoted object belongs to the final step. Stronger exact deliverable ID/body binding is preferable if multiple deliverables per step can arise. |
| P1: legacy run bypass | Removing only the new contract field to reconstruct a pre-upgrade binding lets a final step reach succeeded without review; `semanticSupportVerified` correctly remains false but success is still granted. | Missing frozen contract now returns a legacy-run problem requiring re-resolution. |
| P2: waiver mutates reviewed final body | The initial final waiver branch skipped preparation. After moving the gate, its prepared body still lacked the current waiver. Completing the step added waiver metadata, so final-body digest changed and all-terminal run became blocked without a usable lease. | Final body is now materialized once, includes current effective waiver metadata, and is reused for review and delivery. |
| P2: final noData continuation deadlocks | Continue marks final step skipped, then final gate blocks because there is no draft/reviewable lease; claim returns no packet. | Continue now restores a final-step attempt and requires an explicit noData candidate through the semantic gate. |

These fail-closed deadlocks must not be repaired by bypassing the review gate. The proper repair preserves or recreates a reviewable final candidate/lease, or returns an explicitly incomplete outcome.

## Checks and limits

The independent negative control passed: changing pending candidate one to candidate two retains the lease, creates a distinct preparation, refuses the old receipt, and succeeds only after a new matching synthetic transport receipt. Existing current tests also exercise changed artifact/source bytes, source authority, missing coverage, wrong attempt, wrong channel, unknown verdicts and truncated representation. Their direct `host_semantic` inserts are appropriate synthetic core-contract tests, not live host qualification evidence.

The adapter now retains project/user rule loading and same cwd, disables resolved MCP entries by exact name, and rechecks MCP inventory. Its current inventory digest does not itself freeze all effective user/project/managed configuration or execpolicy files. The intended finite containment record should say which configuration/policy generation and native binary it tested. A later untested change should invalidate capability or be rejected; no assertion of universal containment is needed.

No defects were established in normal pending-candidate replacement. Source/currentness comparisons are deliberately conservative and bind the supplied held content/provenance plus admitted source state. Missing material user answers are the concrete closure gap found here. No claim is made that a bounded semantic reviewer proves truth; the intended invariant is an actually observed, appropriately scoped judgment of the exact delivered generation.

No model, network service, personal configuration, repository settings, or signing materials were used. Native subscription trials authorized elsewhere remain in scope for the implementing agent; this review did not perform them.
