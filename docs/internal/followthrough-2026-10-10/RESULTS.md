# Delivery reliability follow-through — 2026-10-10

Construct still does not meet the fresh-user completion bar. In the single preregistered cohort, ordinary Q&A worked on both hosts without managed state. All four requested-outcome phases failed managed completion: Codex saved no artifact within either six-minute bound; Cursor saved both drafts, but they remained unverified and independent assessment found material reasoning and provenance errors. This is evidence against qualification, not a release recommendation.

Two bounded local corrections are implemented and independently reviewed: explicit semantic-review progress/recovery, and chained numeric grounding. The latter was discovered in the cohort and is covered by regression and installed-package replay, **not** by that earlier native cohort. No new native consumer rerun was used to replace the failures.

Published alpha.27 remains at `24b126021cc61b346d8b873eb40fa31635d2db15`. These changes live only on `dev/fresh-delivery-reliability`. The package version is unchanged; candidate hashes distinguish unreleased local bytes from the published package. No push, merge, tag, publish, deployment, production job, credential change, global security change, or local-memory edit was performed. Repository-local `commit.gpgsign` was already `false` when rechecked; global signing remains `true`.

Local code commits:

- `5283f0d4420d91e6195de759b8db93204ded3780` Expose truthful semantic review progress and bounded recovery
- `393c6e477c4752b92a20d637a3aecae48de37fce` Ground chained calculations in checked arithmetic inputs

## Implemented scope and evidence

| Contract | Implemented/exercised | Boundary still open |
| --- | --- | --- |
| Review availability and recovery | [Kernel projection](../../../src/kernel/workflow/semantic-review.ts), [service packets](../../../src/kernel/workflow/service.ts), and [public broker](../../../src/kernel/broker/tools/run-status.ts) expose unavailable/not prepared/needs review/dispatched/rejected/failed/stale/passed/cancelling/stopped distinctly. Ten [progress regressions](../../../tests/kernel/workflow/semantic-progress.test.ts) cover receipt shape, source generations, unsupported hosts, cancellation, oversized packets and inherited outputs. | A pinned profile does not establish current authentication, permission or successful execution. Only the implemented Codex reviewer profile can execute; no automatic cross-host fallback exists. |
| Integrity of review | Wrong attempt/host, malformed invocation/judgment/problems, and containment failures remain failures. Adapter-shaped negative judgments remain content rejections. Status reads do not launch models, mutate leases or raise trust. Exact final generation remains required. | Independent review is fallible; passing structural checks is not semantic correctness. No new live reviewer completion was established by the consumer cohort. |
| Safe repair | Recovery names the current tier and mutable outputs. Frozen inherited fields cannot be overwritten through final-step submission. Cancellation plus held-output acknowledgment preserves the draft; an independently exercised replacement run can reserve its path again. Expired leases require cancellation settlement through claim. | Automatic bounded rework and interrupted-process delivery recovery remain open. A new run must not replay a completed external effect. |
| Chained numeric grounding | [Validator](../../../src/kernel/workflow/validators.ts) resolves checked derivations to a fixed point, independent of declaration order. Numeric tokenization retains arithmetic operands that prose extraction ignored. Nonfinite values, unsupported cycles and invalid intermediates fail. Nine [new regression tests](../../../tests/kernel/workflow/derivations.test.ts); public installed MCP replay accepts both orders of `36=6*6; 32=36-4`, refuses unsupported intermediate/cycle, and keeps final output a draft. | Existing rounding rules and 1% per-derivation tolerance remain. Tolerance can accumulate or amplify: `181=12*15; 18=181-163` passes under the inherited policy. This is grounded arithmetic under existing tolerance, not exact arithmetic, unit checking, source authority or semantic support. |
| Fresh connected API/MCP/local journey | Source connection exists before installed init; real stdio fixture MCP and scoped loopback GET API accompany local policy. Provider timestamp and local mtime stay fixed while authoritative bytes/units change. Both hosts reach the data. | Four of four outcome phases fail managed completion. General transport traversal and adapter-attested access are not established by model reports. |
| Harness portability | First-slice all-host static conformance: **85 pass, 0 fail, 19 untested**. Full gate and packaged smoke pass after the numeric delta. | Static portability is not native reliability. The untested cells include managed semantic completion/final handback/live execution and unavailable Bob coverage. No full host/model/method matrix was run. |

## Frozen candidates and validation

See [evidence/manifest.json](evidence/manifest.json) for file hashes, raw evidence locations and gate observations.

| Candidate | SHA256 | What ran against it |
| --- | --- | --- |
| Published alpha.27 (unchanged) | `500b2af8836c59a315e475658e0fe87d5f26ac888bb556d84d67955ec034ecbf` | Prior release evidence only; see [release record](../implementation-2026-10-09/RELEASE-alpha.27.md). |
| A: review progress/recovery | `fd5b728dad70c519ee2da9baf25038f2871720eca90ccaf8444ba35d6919e69f` | Required gate: 1,034 pass, 0 fail, 1 existing skip; smoke; static conformance; one native Codex/Cursor cohort below. |
| B: A plus arithmetic | `6e9ccb6622832756ef6ce753e66d8c7b3514eda884f24799048fe8bc133ba062` | Required gate: **1,043 pass, 0 fail, 1 existing skip** (1,044 total); lint, types, packaged smoke; independent review; deterministic installed MCP replay. No native consumer cohort on B. |

Independent review cleared both slices after corrections. It caught malformed/negative receipt distinctions, cancellation/expired-lease guidance, arithmetic operands disappearing under prose date/spacing rules, nonfinite-number acceptance, and compatibility of explicit zero/one identities. The final arithmetic recheck passed **33 derivation/quality tests** and retained the tolerance limitation above. Reviewers performed no code edits or native model calls.

The first installed numeric harness attempt passed its first valid case, then reused that active run because its synthetic workflow accidentally retained default single concurrency. It stopped with a null next claim. The failed attempt and driver remain preserved. A corrected synthetic manifest uses per-input concurrency and a target dedupe key; its four cases are reported separately. This was a harness setup repair, not a changed product assertion or native rerun.

## Preregistered native cohort: all outcomes retained

Acceptance was recorded in [README.md](README.md) before launch. Each host ran once, with three fresh processes: ordinary policy Q&A, initial requested brief, and corrected-source follow-up. Each phase retained the original 360,000 ms bound. Packages installed offline with scripts disabled; the installed launcher served Construct. Existing subscriptions were used with host policy preserved, unrelated tools isolated per invocation, synthetic data, and no outward effects. Full traces/configuration/source reads remain at the locations and hashes in the evidence manifest.

| Host / phase | Elapsed ms | Saved artifact | Completion / observed result |
| --- | ---: | --- | --- |
| Codex Q&A | 37,337 | Not requested | Correct equality boundary; zero runs/work/source registration. |
| Cursor Q&A | 12,699 | Not requested | Correct equality boundary; zero runs/work/source registration. |
| Codex initial | 360,009; timeout | None | No `submit_work`; 31 completed tool calls. Gather remained unfinished. |
| Codex changed | 360,007; timeout | None | No `submit_work`; 28 completed tool calls. New outcome encountered old delivery reservation; producer reclaimed previous gather and read corrected sources but saved no file. |
| Cursor initial | 80,735; exit 0 | 4,973 bytes | Draft saved; final semantic review unavailable; no unsupported review-command retry. It was never completed and was later invalidated by corrected consumed evidence. |
| Cursor changed | 67,161; exit 0 | 5,391 bytes | Draft saved; synthesis rejected valid chained calculation by A's validator. Re-reporting changed consumed source text subsequently failed the run, correctly preserving the prior generation. |

Codex's initial source-report attempt omitted required access-observation expiry and was refused; it recovered the report but never submitted gather. The changed phase tried to cite source snapshot IDs that the resolver does not accept, then recovered to resolvable item references. It also read method closing references before writing an artifact. These are observed friction points; their causal share of model latency is not isolated. Do not attribute either timeout solely to review availability, arithmetic, or one prompt rule.

Cursor's numeric failure is concrete: `36=6*6` was grounded, but `32=36-4` was rejected because the prior validator required the intermediate 36 to occur directly in source text. It then tried an expired submission token, reclaimed, and rewrote source reports as summaries. The consumed-byte change guard correctly rejected that new generation. Candidate B fixes the intermediate-grounding defect, not the producer's source rewriting or semantic reasoning.

## Independent artifact assessment

The actual initial and changed files were frozen before independent Codex assessment. Historic reads are explicitly evidence only about earlier states; current claims require current-phase reads. Artifact/rubric digests remained stable. [Assessment summary](evidence/native-assessments.json) preserves the review checks; no review was invoked for Codex's missing files.

- Cursor initial correctly holds pending conversion/reservation-unit clarification, does not invent conversion, and records denied supplier access. But both hypothesis falsifiers are reversed: the stated observation confirms the hypothesis it allegedly refutes. Its end-of-day as-of claim exceeds the approximately 01:47 UTC reads; provider `updatedAt` is presented as observation time.
- Cursor changed correctly computes 32 each, recommends replenishment against the 60 threshold, and preserves earlier uncertainty. But its hypothesis table treats missing units/null conversion as refuting a hold, whereas policy requires a hold. It falsely attributes every load-bearing number to connected fetches although 32 is calculated and 60 comes from local policy. Its end-of-day as-of claim is again unsupported.
- The frozen changed rubric also explicitly asks for the 28-each shortfall, which the changed artifact omits. That criterion is stronger than the ordinary user prompt; keep the preregistered failure visible and distinguish it from the substantive errors above. It is not the sole reason the assessment fails.
- File existence and process exit 0 passed neither managed lifecycle nor semantic correctness. Cursor labels the review boundary more honestly after this change; that limited improvement does not qualify the product.

## Remaining implementation-ready work

Reuse the existing native ledger and original [intake backlog](../intake-2026-10-09/BACKLOG.md); do not replace its broader V1–V9 acceptance or erase prior failed cohorts.

| Priority / existing item | Concrete implementation and acceptance |
| --- | --- |
| P0 delivery: `work-bc13f708`, `work-d45349d5`, parent `work-79b6e69d` | Diagnose and bound pre-artifact work with per-stage observed timing and a research stopping/checkpoint contract. On fresh natural prompts, produce the requested file or a truthful partial artifact within a preregistered bound, without invented quantities or verification. Retain both timeout cases. Add an interrupted-process test proving the new session can safely resume/settle the prior delivery reservation without a duplicate commitment or skipped tier. |
| P0 semantic repair: `work-bc13f708` | Add explicit bounded rework that identifies mutable producer steps, preserves failed generations, and rechecks current evidence and permissions. Acceptance: inherited bad assessment corrected through authorized producer work; rejected final draft cannot overwrite inherited fields; external effect not replayed; unsupported reviewer yields a useful unverified draft without command loops. |
| P0 numeric policy: `work-bc13f708`, `work-a8273a89` | Decide explicit exact/rounded arithmetic semantics and retain calculation lineage. Test chained tolerance amplification (`181=12*15; 18=181-163`), cancellation/error propagation, unit mismatch, denominator zero, source quantities coincidentally equal, and ordering permutations. Passing syntax/numeric occurrence must not assert semantic entailment. |
| P1 source continuity: `work-c0b5e1bd`, `work-5ab0581a` | Distinguish immutable observed bytes from producer summaries; expose usable historical item refs and observed/provider time separately. Test report omission/recovery, corrected bytes with fixed timestamp/mtime, source denials and schema/unit changes, summary rewriting after consumption, and unrelated change. Implement scoped API/MCP traversal adapters with pagination/cycle/budget outcomes; current generic traversal accounting is not an automatic fetcher. |
| P1 skill application: `work-98b4069f`, `work-2260468a` | Exercise research → specialist synthesis → independent challenge on unseen cross-domain tasks, paired against a baseline. Require materially correct counterfactuals, falsifiers, scoped authority and inference labels in actual artifacts; declarations/method receipts alone are not execution or efficacy. Keep prior unqualified/budget-limited method trials unqualified. |
| P1 readiness/portability: `work-4f056fec`, `work-26313b45` | Distinguish installed/configured/bound/callable/authenticated/observed. All supported hosts must disclose unavailable reviewer/executor early and preserve useful drafts. Run finite fresh-install and restored-session cases without changing user security policy. |
| P1 scheduling: `work-411556aa` | Preserve existing bounded executor evidence; finish the finite post-exit/restart/missed-tick/overlap/budget/revocation matrix. Saved intent without a real clock and executor stays unprovisioned. Synthetic persistent execution must dedupe firings, stop on revoked access and report the actual delivery/verification outcome. No production schedule is authorized by this work. |

## Next bounded validation

1. Accept the existing local handoff and inspect these exact candidates, native traces and open ledger items. Start with the observed Codex pre-artifact and interrupted-delivery paths, then safe semantic repair.
2. Register one finite consumer cohort **before** a later implementation is tested: ordinary prompts only; source connections before init; installed package hash; host/model identity; fixed phase bound; QA state counts; source-read and artifact digests; lifecycle state; independent artifact rubric. A failed case stays in the denominator. Candidate B has not satisfied that cohort.
3. Include API/MCP/local fixtures with changed bytes but fixed timestamps, unknown units/schema, denied/paginated references, source injection, conflicting authority, and an unrelated change. Preserve raw observations separately from summaries. Test that no permissions or verification are inferred from retrieved text.
4. Independently grade falsification direction, current versus historical provenance, uncertainty, requested file, and lifecycle. Keep numeric checks, semantic review and actual action verification separate.
5. Only then extend bounded validation to genuine specialist composition and schedule resumption. A saved schedule or skill declaration does not prove execution after session exit. Full qualification and any publication remain outside this pass.
