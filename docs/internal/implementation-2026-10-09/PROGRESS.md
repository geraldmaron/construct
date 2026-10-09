# Implementation progress — 2026-10-09 18:03 UTC

The broader native parent outcome remains open and implementation has continued after the earlier bounded handoffs. The newest checkpoints below supersede older completion statements; earlier results remain historical evidence. No push, merge, publication, deployment or production data access.

## Fresh consumer result

The latest ordinary-prompt SSO trial used a fresh npm installation of packed alpha.26 bytes, package SHA-256 `933677a74eaa128cba57ec2b59a72aa48aab9e78625c72967f3dae326c2c8015`. Prompt: “Write a PRD for adding single sign-on to LatticeDesk. Save it as sso-prd.md.” No evaluator rubric or Construct hints were appended. Existing Codex subscription authentication remained with the host; user configuration/rules/plugins were excluded. This is native Codex CLI, not Work Cloud. The fixture server was stdio-only and exited with its consumer.

It selected `prd-authoring`, made 30 Construct tool calls and 12 workspace tool calls (including discovery), completed four steps, recorded four sources and seven snapshots, and saved a PRD. The actual source reads included Jira demand, architecture, identity review/schema, sessions, privacy, accessibility, relevant Slack corrections, and an attempted contract fetch returning permission denied. The PRD preserved the SAML/OIDC conflict, no-shipped-SSO state, stable tenant identity, 24-hour session gap, guest uncertainty, data minimization, accessibility, break-glass, key rotation and rollback. It did not infer contract terms or legal approval. [Complete evidence and assessment](evidence/sso-reference-coverage/score.json), [artifact](evidence/sso-reference-coverage/sso-prd.md).

Limits: one run does not qualify the release. Skill bindings/content inspection do not prove method application. Structural “validated” status does not prove semantic completeness or actual test execution. The consumer's Git check encountered an Xcode license error and is not counted as passed. A live trial also exposed redaction of legitimate versioned URLs; the shared redaction boundary is being corrected, with secret-retention negative tests.

## Shared mechanisms changed

- Content-driven invalidation across local files and host reports: committed as `6febaa30`.
- Typed unambiguous deliverable aliases preserve specialist routing; skills stay experimental without execution evidence: committed as `d798abcc`. This is enum normalization, not a prose keyword classifier.
- Bounded research reference accounting applies to 17 discovery workflows and stores content digests, provenance, edges and explicit dispositions. It follows no network links itself and grants no authority. Research slice: lint/typecheck, 817 passing tests plus one skip, packaged smoke passed.
- Read revocation is enforced in refresh/report/peek and cached evidence resolution. Ambiguous bare IDs/URLs fail closed; qualified source identities remain distinct. Source boundary slice: lint/typecheck, 821 passing tests plus one skip, packaged smoke passed.
- In progress: distinct access observations (denied/auth-required/unsupported/no-results), schema/units identity, truthful capability scopes, URL redaction and metamorphic tests.

## Generalization requirement

Release is blocked on shared mechanisms and held-out behavior. No production branches may name the fixtures or encode expected answers. Added graph tests rename schemes and identities, reorder roots, and split/merge documents while preserving the same material dependency. Schema tests reorder metadata and change units under an unchanged provider timestamp. The next live scenarios cover an unrelated domain, correction/incident impact, ordinary Q&A with no managed run, and continuation after session exit.

## Remaining

Durable skill activation/application and verification receipts; semantic-support limits; executor-bound scheduling and truthful absence; fresh Harbor and incident/source-change trials; held-out repeated outcomes; all-host conformance; final native ledger handback. Original intake and full implementation backlog remain under `docs/internal/intake-2026-10-09/`.

Local commit creation failed twice through the configured 1Password signing agent: `error: 1Password: agent returned an error; fatal: failed to write commit object`. Signing was not disabled. The coverage slice remains staged; later fixes are reviewable in the working tree. This blocks signed local commits, not independent implementation and testing.

## 17:07 checkpoint — independent review corrections

Held-out archive trial (fresh packed install, SHA-256 `f0f0153a36dfaf07f04c4c7addd3a589b824cf6436a56abe32e368e90406b0f3`) completed via research-brief: four steps, four sources, four snapshots, nine observations. Its brief preserves the total 12 operator-hours, cleared subset, handling constraints, absent retention owner and inaccessible deed. It makes no public-release claim. Fixture source wording does provide several constraints explicitly; this is a source-use test, not evidence of autonomous professional expertise. [Assessment](evidence/digitization/score.json), [artifact](evidence/digitization/digitization-brief.md).

The plain local policy question used bootstrap/project_context/check_answer and created **zero runs, steps, deliverables, sources, observations or work items**. [Evidence](evidence/archive-qa/score.json).

Independent review reproduced generic defects in weak complete reports, capability/permission aliasing, partial-read freshness, structured artifact receipts and remote relative links. Corrections now preserve strong explicit weak sightings, keep observations separate from available/permitted grants, track item read coverage, normalize string/structured artifact paths consistently, and reject acceptance/finalization after artifact or recorded evidence bytes change. Remote Markdown links retain their base URI. These counterexamples and related paths passed **62 focused tests**, and typecheck passed. The earlier full suite caught 12 old fixtures relying on string-only verification claims; those now use explicit reported inspection results. The affected integration/security group passed **53 tests**. Full final gates remain pending.

Method bodies are now delivered by default on claim; method assignment and host-reported application have distinct durable receipts, with unreported application explicit. These latest changes have not yet been exercised by a fresh packed consumer. Reports and structural checks still do not prove semantic support or independently executed tests. Source freshness is conservative across all retained items unless required item references are supplied.

Still actively implementing the real execution boundary: a clock tick must not borrow interactive capabilities, cron/CI recipes must not pretend a model executor or durable database exists, and execution verification must come from a host-owned command observation rather than a model's success claim. Signed commits remain blocked by the configured 1Password signing agent; no signing configuration changed.


## 17:32 checkpoint — fresh package and actual executor

The last complete required gate passed **844 tests, zero failures, one existing skip**, lint, typecheck, packaged smoke and static all-host conformance. Later command-binding tests (two), standing-intake tests, and persisted-record counterexamples passed; a new full gate is running. No live-model result is inferred from static conformance.

The renamed SSO consumer used package `57e1d435ea8e403585981a1aae3b70d612067ff1bfec217bc673643b400b9967`, an ordinary prompt, changed product/prospect identities and a changed URI scheme. It completed `prd-authoring` with three durable method bindings and explicit applied/deferred reports whose method and evidence bytes are pinned. [Assessment](evidence/sso-final/assessment.json), [PRD](evidence/sso-final/sso-prd.md). These are host reports, not independently qualified method execution. Git validation hit the host Xcode license condition again.

The first actual after-origin-exit clock trial blocked without an executor, then resumed the same firing with the explicit Codex adapter. It completed after reading a changed telemetry schema under the same source timestamp and correctly held the release at exactly 1%. [Evidence](evidence/executor-exit/assessment.json). It also exposed invented native finding/lesson IDs in the record step; this means the trial is **not an end-to-end pass**. The shared submission boundary now rejects such persistence claims and tells runners to use actual IDs or empty lists. A fresh replay is pending. Previous snapshot content was not supplied to the model, which honestly left historical field-level drift unknown.

The CLI command wrapper now records actual argv, exit, timeout, artifact bytes and attempt in an append-only host receipt. A model cannot pair that receipt with a different reported command or exit. Strong acceptance of test steps requires a matching current receipt. It still does not prove that the chosen command adequately tested the result. The prompt/acceptance surface states this limit.

Standing `maintain` intake now saves its mapped inputs and schedule as an idempotent trigger and starts no immediate run. The returned clock/executor state is explicitly unprovisioned. No system cron, daemon, CI runner or external event subscription has been installed. Only Codex has a verified implementation of the bounded local unattended adapter; every other supported interactive host is reported as unprovisioned for unattended execution.


## 17:49 checkpoint — completion must mean delivery

Latest required gate: **852 pass, zero failures, one skip**, lint/typecheck and packaged smoke. [Current assessment](RESULTS.md) links exact code and evidence. The interrupted managed outcome resumed the same occurrence, wrote a real brief, and recorded an actual command receipt with matching artifact bytes. The normal scheduled review reached succeeded but failed the requested file destination; it is explicitly scored **FAIL**, and the earlier progress statement about a produced file was corrected. Shared final-step validation now requires the requested local artifact and the claim packet carries that destination. A fresh full ordinary-request → process-exit → executor replay is currently running.

The release dry-run fails because the full live record is absent; CI now enforces that check, and runtime/invocation/dependency changes invalidate its evidence identity. Static all-host conformance is being saved independently. No release action was taken.


## 17:53 final evidence checkpoint

The final fresh ordinary scheduled-file replay passed: [assessment](evidence/schedule-artifact/assessment.json), [actual release brief](evidence/schedule-artifact/release-brief.md). The originating consumer exited before the explicit bounded executor started. It read the changed count schema under the same timestamp, returned the correct HOLD, wrote the requested file, and bound its digest. This review has structural assurance, not a command-test or semantic qualification. The earlier database-only attempt remains scored FAIL.

Final gate: **852 passing tests, zero failures, one existing skip**, lint, typecheck, packaged smoke. Saved all-host static conformance: **91 passed, zero failed, seven untested live-host cells**. The interrupted managed-outcome test independently has an actual command receipt and existing local artifact. No permanent clock or external connector was provisioned. Current code-linked verdict and remaining requirements are in [RESULTS.md](RESULTS.md).

## 17:59 handoff preparation

The final fresh scheduled-file pass and gate are retained in RESULTS.md. Native work now records completed executed verification plus bounded executor and standing-intake children; the parent program remains open. The third normal signed-commit attempt failed with `error: 1Password: failed to fill whole buffer; fatal: failed to write commit object`. No signing bypass was used. Final native run verification and partial-item handoff are being recorded.

## Final native handoff

Managed run `run-7b6676b3` succeeded and produced `deliverable-b180f8d3`. Its actual host command `npm run lint && npm run typecheck && npm test && npm run smoke && git diff --check` returned zero with stable subjects; [execution receipt](evidence/native-verification.json), [native result](evidence/native-run.json). The top-level deliverable records execution verification while its embedded content receipt remains explicitly structural. Semantic support remains unverified. The check completed at 18:01 UTC.

The parent `work-18402da5` remains open. V1 and V3 are complete, along with bounded executor and standing-intake children; V2 and V4–V9 preserve their original remaining criteria in the native ledger. [Recorded checkpoint](evidence/native-work-checkpoint.json), [local change inventory](evidence/local-change-inventory.json). The saved code-linked verdict is not modified after verification. Partial claims are released for continuation. No global settings, local memory files or external systems were changed. The user workflow guide has the added implementation guidance from this pass.


## 18:27 UTC — independent review counterexamples

The independent review is **not cleared**. Three confirmed issues are being repaired: cross-trigger occurrence/overlap collisions, terminal completion without required command evidence, and stale freshness after unchanged successful reads. Format 5 scopes firing uniqueness to the trigger with an explicit backed-up migration. Regression tests cover trigger skip/replace/queue isolation, complete/partial read freshness, A→B→A, and public execution submission/CLI completion. Full suite and an interruption after actual work are still pending. The older one-millisecond timeout is only startup interruption evidence, not mid-work recovery.


## 18:36 UTC — ready for independent counterexample recheck

Two P1 fixes and observation freshness are ready; exact file/package hashes are in evidence/review-checkpoint.json. Format-5 supported migration completed with a backup. Full gate before the additional retry-budget fix: 861 passed, one existing skip, lint/types/smoke pass. Static conformance 91/0/7 untested cells. Actual mid-work interruption found an expired-lease/validation-retry accounting defect, now regression-tested; fresh live recovery and final gates continue. Signing has no pending process and remains optional to verification. See REVIEW-CLOSEOUT.md.


## 18:42 UTC — bounded replay and gates complete

Actual mid-work recovery, independent same-key schedules and duplicate no-executor behavior pass; see evidence/midwork-retry/assessment.json. Held-out warehouse MCP/local schema ambiguity produced the correct evidence-backed hold and actual file. Latest gates: 862 passed, zero failed, one existing skip, lint/types/packaged smoke pass; static 91 passed, seven untested cells. The user disabled signing prompts for this repository only, and the staged research commit succeeded as 58146ab5. Independent recheck clearance is still pending. Broader native parent acceptance stays open.


Local code checkpoint: `2b1720e0` (implementation and regression tests), following `58146ab5` (bounded reference research). [Exact final file hashes](evidence/review-final-checkpoint.json). The review implementation run `run-0a70f6ba` has an actual [current-lease command witness](evidence/review-native-verification.json); it does not complete the broader parent outcome. Independent recheck is still pending.


## 18:47 UTC — final local handoff

Code committed at 2b1720e0 after research commit 58146ab5. Native run run-0a70f6ba succeeded with actual command receipt execution:871 and current content hashes; deliverable-8c6497bf has structural plus observed-command assurance, not semantic proof. All owned controls/fixtures and claims are closed; native review item remains open for the independent recheck now underway. User-authorized signing change is repository-only: local false, global true, 1Password unchanged. No publication or deployment.


## 18:59 UTC — retry approval budget corrected

The reviewer’s P2 reproduced in four of six public-broker cases. Approval now counts the same non-expired attempts as validation enforcement. All six cases complete after a correctly bounded retry; existing waiver tests still pass. Full gate: 868 pass, zero failures, one existing skip; lint/types/smoke pass, static 91/0/7. See RETRY-GRANT-RECHECK.md. Independent recheck is pending. The user’s challenge of the limits framing is accepted: feasible supported behaviors will be classified and closed, with real external boundaries stated precisely.


## Scope challenge progress — actual mechanisms, not closure by wording

- V6: full-history search now filters before page limits for activity, runs, entities and work; context pages carry revision, selection reason, omitted count and continuation. Existing-record mutation rejects stale continuation; new append-only activity does not change the frozen snapshot. Resolved decisions and source revisions survive a new store and another host binding. Six new regressions plus ten public-tool tests pass.
- V8: public `skill evaluate` explicitly executes a predetermined bounded evaluator; passing records are bound to skill digest/version, host/model, evaluator files, evidence bytes and expiry. Qualification has a real success path; changed bytes, wrong host/model, expiry, missing cases/checks, unknown, self-review, missing evidence, no-op commands, command failure and timeout cannot pass. Twenty-seven focused adapter/registry/tool tests pass. These protocol fixtures are not live model competence evidence.
- Review P2: committed 48b72284, full required gate 868 pass/0 fail/1 existing skip plus lint/types/smoke. Independent focused recheck pending.
- In progress next: V2/V5 source observation/mapping contracts, then V1/V7 substantive claim support and intended-verifier binding, then V4/V9 disposable scheduling, fresh packed-host/domain journeys, independent scoring and canonical release records. Original V1–V9 acceptance is preserved.
- Host probes: Codex and Cursor existing subscription status confirmed; Claude Code explicitly reports loggedIn false/authMethod none. OpenCode lists a GitHub Copilot OAuth provider as well as other providers; the earlier blanket API-only assumption is stale, so that subscription-backed interface is being checked. VS Code exposes GUI chat but no CLI outcome stream; Bob version probe is ENOENT. No credentials were copied or displayed.

Current retrieval/qualification changes are uncommitted and have focused tests/typecheck; the new combined full gate has not yet run. This progress entry does not replace an independent outcome evaluation.

2026-10-09 retrieval/qualification checkpoint: combined required gate passed: lint, typecheck, 889 tests passed/0 failed/1 existing skip, packaged smoke; all-host static conformance 91 passed/0 failed/7 untested. No live qualification claim is inferred from the adapter protocol fixtures. Source access/mapping contracts are next.

Source observation/mapping slice: public sources check compares permission, transport operation, exact scope, principal, session, expiry and provenance without making a grant. Public sources map profiles unknown data and applies evidence-backed JSON-pointer mappings with source-qualified identities, units/timezones and coverage. Optional additions remain usable; renamed/colliding IDs, missing/null/type/unit/timezone changes and changed interpretation evidence block affected calculations. Partial or unrelated item coverage cannot certify source-wide aggregation. Fifteen added public-contract cases across api/mcp/local adapter observations pass; these exercise the adapter contract, not live network authentication. Required lint/typecheck/full-test/smoke gate passed; logs retained in evidence/source-contract-*.log. Native context checkpoint b4f571a4 remains independently reviewable.

Verification checkpoint: 930 tests pass/0 fail/1 existing skip; lint/types/packaged smoke pass. check_answer now reports supported/contradicted/unknown for explicit bounded claims and recognized present-tense polarity clauses, preserving source digest/provenance and disagreement. Typed sums consume current mappings, units and complete coverage, and feed witnessed arithmetic into numerical grounding. Unrecognized semantic claims stay unknown; this is not a general semantic grader. A planning step can freeze verificationContract (identity/version/argv/code and rubric files/criteria); later verification checks exact invocation identity, unchanged verifier files and actual JSON criterion results. Irrelevant successful commands, missing/unknown/other criteria, changed rubric, changed artifacts and fake receipts fail. No-contract execution remains command-observed only, with no claim of intended-purpose sufficiency. Pagination metadata now preserves omitted items for both native reader pages and host reports, including idempotent repeats. Live independent outcome evaluation and default contract selection still need the fresh consumer matrix.

2026-10-09 19:51 UTC status: no hung host/model/probe. Reviewable commits b4f571a4 (history/qualification, 889 pass), 0924fcd5 (source observations/mapping, 904 pass), 152abf50 (claim checks/intended verification/pagination, 930 pass); each has passing lint/types/full test/packaged smoke evidence. Current uncommitted traversal slice has 15 focused passes for real local/HTTP/MCP resource reads and public CLI, reference-style/relative links, cycles, material recall, denied/irrelevant/injected paths and deadlines. Full gate found old command-help assertions which need source traverse added; correction is in progress. Next: traversal checkpoint, fresh packed consumer journeys plus independent artifact scoring, then disposable scheduling and canonical release matrix. Core claim checks remain bounded and the intended-verifier contract is optional; broader semantic quality and automatic meaningful contract/method selection are still live acceptance work.


2026-10-09 traversal checkpoint: required lint/types/full-test/packaged-smoke gate passes: 936 pass, zero fail, one existing skip; static all-host conformance 91/0/7 untested. Fifteen focused research/traversal/CLI cases pass. The default full run twice exposed an existing wall-clock startup assumption in the lock test; it now asserts both responses while the exclusive lock remains held, always checks the refusal, then releases the lock and verifies binding. This preserves the lock invariant without treating concurrent process startup speed as evidence. Production directory traversal and the generic adapter boundary are shipped; HTTP/MCP fixtures exercise real transport reads, not automatic product wiring across those transports. Independent review found mapping authorization/schema, failure-readiness and assertion-context defects in the prior checkpoint; those are being corrected before live closure. VS Code UI inspection took 412 seconds and exposed only a workbench container; no usable native chat session established.


2026-10-09 20:09 UTC independent-review corrections: mapping and profiling now enter through the shared authorized evidence resolver, including active/read permission and exact current item bytes. Schema scalar type and nullability must agree with the mapping before rows become calculable; unrelated fields remain tolerated. Adapter failure outcomes can carry their actual principal/session/operation/scope; unscoped failed whole-source refreshes explicitly invalidate read readiness rather than silently falling back to an old success. Bounded assertion checks no longer extract matching sentences from their discourse: the entire source and answer must each be a recognized standalone assertion, otherwise support remains unknown. This is a conservative finite assertion comparison, not independent semantic evaluation. Sixteen new public regressions cover the four counterexamples and variants; 44 focused tests pass. Required gate: 952 pass/0 fail/1 existing skip, lint/types/packaged smoke pass. Qualification's self-reported producer/reviewer labels remain a confirmed separate gap and are next. Fresh host consumers, cross-source production traversal wiring, method quality, disposable clock and canonical release evidence remain open.


2026-10-09 20:39 UTC checkpoint: reviewer cleared the four original counterexamples at 8b9b3891 across 47 independent checks. Adjacent nullable-integer and descriptor-free-denial cases are now fixed with four public regressions (48 focused source/claim checks pass). Native qualification now has an explicit Codex producer/reviewer execution path; report-only evaluator output remains experimental. Each case receives a fresh producer workspace, frozen input/rubric bytes, new required output files, a separate reviewer context/session, actual invocation/exit/transcript receipts and witnessed artifact digests. Seven native adapter protocol fixtures plus existing evaluator fixtures pass (22 focused); these fake CLI fixtures are not real model quality evidence. A six-case predeclared real research corpus is running. Attempt1 retained a provider/model initialization failure across all six cases; attempt2 uses the existing non-secret configured subscription provider. The full gate found one expected observation-shape assertion needing the new conservative applicability fields; its correction is in progress. VS Code read-only UI inspection returned after 1040 seconds despite timeout request; a chat surface exists, but no consumer test was submitted. Further UI probes paused while CLI work proceeds; no pending approval is blocking this checkpoint.


2026-10-09 21:08 UTC checkpoint: independent review cleared the prior nullable-integer and ambiguous-denial P2s at e28267c6 across ten checks. Two further qualification counterexamples are repaired: external graders cannot replace native evidence before hashing; receipt bodies and exact case/input/rubric/skill/artifact relationships are validated, including unique invocations/sessions/case references and actual reviewer judgments. Twelve focused native tests pass, including grader mutation and twelve contradictory/reuse variants. Current required gate: 968 pass/0 fail/1 existing skip, lint/types/packaged smoke pass; full tests use supported test concurrency4 without weakening assertions. All-host static conformance is being collected. No current live qualification is claimed: pre-fix attempts are retained and invalidated for that purpose.

Fresh packaged, correctly-before-init, API/MCP/local ordinary-prompt journeys found material failures. Codex and Cursor both answer exact-threshold Q&A with zero runs/work/deliverables/source registrations. Cursor Composer2.5 writes materially useful files but skips failed managed-tool calls; first attempt has no managed run or durable sources. A shared schema-bearing error-recovery change plus explicit manage/maintain kinds is under fresh replay: a later request repairs classification/claim errors, but the complete managed outcome is not yet a pass. Codex's initial run reached research synthesis and challenge, then hit the fixed360-second deadline before creating the promised file. Its broker calls took2–211ms; repeated large claim packets, a reference-coverage retry and a late independent ledger-claim sequence consumed model turns. The new process is testing correction/resumption. Neither a useful untracked artifact nor a database draft is counted as delivery. Shared activation, coordination/checkpoint and bounded delivery defects remain active work; deadlines are not being extended to conceal them.


2026-10-09 21:24 UTC checkpoint: independent review cleared the qualification integrity fixes at d1615f84, reviewing HEAD0b4e6401 with those files unchanged: 30 contract checks and eight in-memory evaluator checks passed. Coverage includes refreshed-hash substitution, mismatched metadata and bindings, cross-case replay and grading-time mutation. This bounded clearance does not establish semantic quality, actual live qualification or successful fresh managed journeys. No repeat of that narrow review is needed unless its contracts change.

The shared managed delivery/resumption correction passes eleven new public regressions and the required gate: 979 pass/zero fail/one existing skip, lint/types/packaged smoke. [Mechanism, diagnosis and limits](MANAGED-DELIVERY.md). Managed claims reserve their requested file without a second governing commitment; observed ended/dead sessions can reclaim the same step, with completed steps preserved and stale tokens rejected. Ledger settlement and run completion are atomic. A held draft or file checkpoint is not acceptance. Fresh replay remains pending, with the same ordinary prompts and 360-second limit. Earlier runner loss has an unconfirmed cause, not an established tool-session-reset explanation.


2026-10-09 21:34 UTC checkpoint: native qualification attempt5 completed in12m48s, with all six producer/reviewer case receipts. Four cases pass all required checks; the archive method-application check fails on additional handbacks, and composition factual correctness is unknown because the artifact narrates an external lookup without evidence supplied to the reviewer. The corpus remains unchanged and qualification is false. [Inputs, outputs, independent judgments and safe native receipt metadata](evidence/native-research-attempt5/assessment.json). The two no-skill baselines pass and do not establish incremental benefit. Both wrong-output controls were rejected.

At local commit3a96edb1, fresh Codex ordinary-prompt investigation completes four managed steps and writes the requested artifact in350314ms within the original360000ms deadline. The new-process correction follow-up is still running. Cursor's same candidate writes artifacts but completes zero managed runs; the initial independent artifact review passes, while the changed artifact omits the predetermined28-unit shortfall and fails that rubric criterion. Its failed start is now traced to marking source unknowns as person-answer blockers.

The shared intake contract now represents open evidence with blocking=false and handling=investigate or carry_unknown, without an assumed answer. Those questions remain frozen on the run and visible in each step. Real permission/intent/destination gates remain. Public negative cases reject mixed assumed-answer/blocker combinations and preserve required inputs. General execution errors carry recovery schema too. Required gate passes984 tests/zero failures/one existing skip, lint/types/packaged smoke; schema descriptions were shortened to retain the existing4500-byte all-host budget. [Tests](evidence/evidence-gap-tests.log). Fresh replay of this distinct correction is next; no artifact or workflow success is inferred from these tests.


## 21:51 UTC — fresh consumer denominator and source-change counterexample

Code revision `47147c7a`; required gate: 984 pass / 0 fail / 1 existing skip, lint, typecheck, packaged smoke; static conformance: 91 pass / 0 fail / 7 untested. Repository-local commit signing is disabled at the user's request; global signing remains true.

[Complete fresh consumer archive](evidence/fresh-journeys/assessment.json) retains all six trials. Every ordinary policy question was correct and created zero managed state. Of twelve managed requests, the latest Codex pair completed and passed independent artifact assessment; nine other requests did not complete their managed lifecycle and one was interrupted without a completion receipt (cause unknown). No deadline was increased. The latest Codex runs used the research-brief and revise-deliverable workflows, completed all eight steps, wrote the actual files and completed both native delivery reservations. [Codex assessment and lifecycle](evidence/fresh-journeys/fresh-codex-delivery/assessment.json). Individual phase receipts, unchanged artifact bytes and safe source/tool observations are alongside it.

Only the latest three pairs have independent artifact review: four artifacts pass and two corrected Cursor artifacts fail. Cursor's newest pair now starts managed work but remains in the generic command-verification workflow under explicit shell denial. Both independent reviews reject the omitted quantitative gap; the newest also rejects an execution recommendation beyond the request's recommendation-only boundary. Artifact usefulness is not managed completion. These remain shared routing/verifier/completeness work.

The six-case native investigative-research qualification completed with four passing cases, one failed method handback and one unknown correctness judgment due to missing claimed lookup evidence. Qualification remains false. Both no-skill baselines passed; both deliberately bad controls were rejected. Keep all of these in the denominator. [Qualification result](evidence/native-research-attempt5/assessment.json), [protocol and review](NATIVE-QUALIFICATION.md).

A new deterministic public-broker reproduction shows stale analysis can inherit a new source digest during final verification: source changes between production and verification, artifact retains the earlier assertion, but the run succeeds and the final receipt names the current source bytes. [Counterexample](evidence/stale-delivery-before.json). No fix is claimed at this checkpoint. The shared correction must preserve frozen evidence, fence dependent work, allow intentional output edits and support an honest new analysis generation without duplicating an existing trigger occurrence.

Native executable children remain open: `work-bc13f708` (non-code routing/verification and scope/completeness), `work-0b8e5dbe` (claim-scoped source authority), and `work-2260468a` (scoped method execution evidence). The parent program and original acceptance criteria remain open. Production HTTP/MCP traversal, actual composed specialist execution, conditional lenses and full disposable scheduling acceptance still need implementation or exercised proof; these are work, not completion-by-limitation.

The execution transport briefly disconnected during a read-only inspection, then recovered. No model trial was running. The task control session and claim were renewed successfully. No push, merge, deployment, publication or permanent system job was performed.


## 21:59 UTC — consumed evidence generation is now fenced

The shared workflow service now preserves inherited evidence bytes and rejects changed/lost consumed input both before claiming dependent work and when submitting under an existing lease. It cancels outstanding work/decisions with an explicit re-derivation reason, releases broker-owned delivery, preserves previous successful outputs, and does not replay an explicit occurrence key. Intended edits to a produced local file retain old bytes as historical baselines rather than current external support. [Before](evidence/stale-delivery-before.json), [after](evidence/stale-delivery-after.json), [six public regressions](../../../tests/kernel/broker/evidence-generation.test.ts).

Focused related checks: 22 pass. Required gate: 990 pass/0 fail/1 existing skip, lint/types/packaged smoke; static conformance91/0/7. An initial parallel gate failed the unchanged two-second hook latency check; its log is preserved alongside the passing serial run. Current capability and gap assessment is rewritten in [RESULTS.md](RESULTS.md). The broader program remains open.


## 22:08 UTC — research method and scoped reviewer evidence

Method0.3.2 and reviewer public-execution transport pass16 focused checks and the full992-pass/zero-failure/one-skip gate, lint/types/smoke; static91/0/7. [Current qualification notes](NATIVE-QUALIFICATION.md). An independently authored two-domain forward test is archived with its single-agent limitations. The original six-case corpus is running in fresh native sessions with unchanged inputs/rubrics; all previous failures/baselines stay in the denominator. The native run is bounded and task-owned, with a durable supervisor receipt; no permanent service exists. Non-code routing/verifier selection and the broad original acceptance remain open.


## 22:13 UTC — existing Codex evidence made independently inspectable

The latest successful pair now has an [archive supplement](evidence/fresh-journeys/fresh-codex-delivery/supplement/archive-scope.json): exact ordinary prompts, sanitized invocation arguments, distinct native thread-start and completion events, actual local fixture bytes, both native source snapshots and manifests, all eight step outputs/receipts, deliverable ancestry, frozen workflow/skill digests and native delivery state. This is a projection from existing records, not a model rerun. Private reasoning and lease tokens are omitted; archive hashes identify every file.

The corrected-record prompt requested reanalysis. This pair does not prove automatic stale-work detection, interrupted-work recovery, unfamiliar schema inference, conditional lenses, or independent method quality. All six trials and their failures remain in the denominator. The routing candidate now exposes each registry workflow's actual verification requirement and eligible alternatives before general command-based work starts; fresh native behavior is still pending.

Routing correction gate: 31 focused checks and full 995 pass/0 fail/1 existing skip; lint/types/packaged smoke pass; static all-host91/0/7. The unchanged fresh Cursor `verifier-fit` replay is running with the original six-minute phase limit and Shell(*) denial. Current research qualification has reproduced the archive handback failure; final six-case result is still pending.


## 22:19 UTC — failure retained and next corrections bounded

Method0.3.2's unchanged six-case replay completed in15m01s without timeout: five cases pass, while archive handbacks still fail. The composition packet now passes because the reviewer receives actual exposed external-read results; this is still consumption of a supplied specialist packet, not a real specialist execution chain. [Complete archive](evidence/native-research-v2/assessment.json). Method0.3.3 now distinguishes prerequisites for the deliverable requested now from conditions for hypothetical later execution. It is unqualified pending new native evidence.

Cursor's seventh fresh trial (verifier-fit) completed all phases but bypassed classification/managed work: both files exist, zero runs/work/source registrations. It attempted source reports for undeclared IDs and skipped their failures. The routing metadata candidate therefore has no behavioral acceptance yet. Its independent artifact assessment is running. Bootstrap now puts the current request's lifecycle before setup/status, while headless workers receive only assigned-run instructions. This is a testable shared instruction correction, not deterministic semantic routing or proof that a host will obey it.


## 22:36 UTC — startup integration rather than another prompt replay

The installed Cursor skill is actually read, but its managed lifecycle is bypassed. The disposable CLI hook canary wrote its file with zero hook observations, despite a deny-all preToolUse callback. [Probe](evidence/cursor-hook-probe/assessment.json). The documented always-applied Cursor rule now carries the same lifecycle guidance as bootstrap; init and doctor report its state, preserve project edits, honor no-wire/dry-run and refuse symbolic links. This does not claim enforced handoff. Focused checks cover every supported host. Full gates are running before a fresh installed-package test.

The complete denominator is now seven fresh trials/fourteen managed requests: two pass, eleven fail managed completion, one lacks a completion receipt. Of eight independently reviewed artifacts, five pass and three fail. Earlier failures and no-skill baselines remain retained. Method0.3.3 is still unqualified; a bounded eight-case native run includes two independently authored heldouts. The rejected 24-minute configuration attempted before it made no model calls; the active run uses the existing 20-minute product limit.

Startup integration gate completed: lint/types, 999 pass/0 fail/1 existing skip, packaged smoke and static all-host91/0/7. [Gate receipt](evidence/startup-gate.json). Fresh Codex and Cursor standalone trials are now bounded at six minutes per phase, nineteen minutes total, with direct installed-package MCP launch and no checkout logging wrapper. Their explicit synthetic-source configuration remains part of the test setup; model resolution and host compliance are still measured limitations.

The first standalone launch for both hosts failed during fixture setup because the outer sandbox denied binding 127.0.0.1; no package initialization or model call occurred. Both process receipts are retained in the workspace. The same bounded trials were relaunched with approved loopback access under the standalone-live tag; permissions inside each native host remain unchanged.


## 22:43 UTC — standalone Cursor lifecycle passes, artifact acceptance fails

Direct installed-package Cursor now completes both ordinary managed requests through research-brief (eight steps, two completed work reservations, four deliverables) in92s and99s. Ordinary Q&A still creates zero managed state. The independently verified initial file passes all four checks. The corrected file fails correctness: it omits the28-unit shortfall and adds incorrect counterfactual arithmetic about reservations in cases and retained12-case stock. Its main32-unit calculation, source refresh, uncertainty and recommendation-only scope pass. [Complete standalone evidence](evidence/fresh-journeys/fresh-cursor-standalone-live/assessment.json), [independent judgment](evidence/fresh-journeys/fresh-cursor-standalone-live/independent-assessment.json).

This establishes a candidate lifecycle improvement, not a passing full journey or causation from the startup rule alone. The candidate also changes bootstrap and method wording; no ablation was run. The corrected run's synthesis/challenge method application remains unreported, not independently executed. Broad acceptance stays open. Next correction needs actual artifact-obligation and verifier coverage, including all material counterfactual calculations; another instruction-only replay or fixture-specific28 check is insufficient.


## 22:49 UTC — eight-case qualification ended within its bound

The runner exited1 at20m01s. Six case reviews pass, including both new heldouts; archive evidence remains unknown, and the composition reviewer hit the original deadline without a judgment. Qualification is false, with all eight artifacts retained. [Full result](evidence/native-research-v3b/assessment.json). No automatic rerun or deadline extension follows. The remaining standalone Codex correction is independently bounded by its original six-minute phase timer.

The parent requested a gut-check of the rubric. [Recorded distinction](RUBRIC-REVIEW.md):32 versus60 settles the ordinary threshold decision; an explicit28 gap was stricter than this request and must not become a universal release condition. Frozen scores and all failures remain intact. Wrong counterfactual arithmetic is a separate substantive defect. Prospective verification must cover actual material obligations before managed success.


## 22:53 UTC — bounded checkpoint complete

Standalone Codex initial and correction each hit360seconds. The correction saves7356bytes and passes independent correctness/uncertainty/evidence/file review, but the managed lifecycle remains incomplete. The initial requested file is absent. [Full direct-package evidence](evidence/fresh-journeys/fresh-codex-standalone-live/assessment.json). Both supervisors have final receipts; the native research supervisor has also ended. No model trial is left running.

The complete warehouse cohort is9Q&A passes with zero state;18managed requests,4native completions,13incomplete and1unreceipted interruption. Independent review covers11actual artifacts (7pass/4fail under their frozen rubrics) plus1missing artifact. Only3requests have both native completion and a passing artifact. The rubric critique preserves these scores while separating optional numeric-gap presentation from actual decision quality.

Code remains e6646f9a, verified by lint/types/999pass/0fail/1skip/packaged smoke/static91/0/7. Later changes are evidence and analysis only. Remaining implementation is explicit in VALIDATION-STATUS.md and RUBRIC-REVIEW.md and the open native children; no semantic-verification or full release acceptance is claimed.
