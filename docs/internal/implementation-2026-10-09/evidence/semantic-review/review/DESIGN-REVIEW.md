# Semantic completion design review

Reviewed repository: `/Users/geralddagher/Developer/Projects/construct`, commit `134b8bf03cf1e34bfb899cd9407fc6ab6c685bd7`. Read-only review; the checkout was clean when inspected. Scope: current verification, verifier contract, delegation, source identity, workflow completion and acceptance. No model worker, external service, personal setting, or signing operation was used.

## Recommendation

Add one first-class semantic completion requirement, one immutable review bundle, and one adapter-observed semantic receipt. Enforce them through one shared completion predicate. Keep command verification separate. Reuse bounded host execution infrastructure, with native Codex and Cursor adapters, rather than creating a kernel model runtime or making existing delegation integration a prerequisite.

For a decision-bearing managed outcome, success requires a completed permitted reviewer invocation against the exact frozen obligations and final artifact/source generation, with all material obligations covered and passed. Missing execution, missing coverage, unknown, failure, or stale bindings leave the result an explicitly unverified draft and prevent managed success and accepted/final promotion. They do not grant permission to launch a worker or widen its access. A received review remains fallible; its assurance is scoped observed review, not proof of truth.

## Confirmed current boundary

The requirement is stated in `docs/internal/implementation-2026-10-09/RUBRIC-REVIEW.md:9` and `:13`: decision-relevant obligations, frozen before the new trial, actual final artifact and source generation, observed result, and no substitution by role headings or structural checks.

Two independent sterile probes reproduce the missing completion gate. The candidate file recommends moving model execution into the kernel even though the held source says to keep the kernel host-agnostic. A script that never reads the artifact or source prints `semantic_correctness: pass`. Both cases reach `run=succeeded`, deliverable `trust=validated`, and `semanticSupportVerified=false`: once with no verifier contract and once with that script frozen as the intended verifier. This does not demonstrate a secret claim of semantic assurance; the current records accurately say it is absent. It demonstrates that managed success currently permits its absence.

Evidence: [probe source](snapshot/tests/hosts/semantic-design-gap.test.ts), [test output](design-gap-test.log). Both tests passed. Reproduce from this directory with:

```sh
node --test snapshot/tests/hosts/semantic-design-gap.test.ts
```

Relevant current contracts:

| Boundary | Current behavior and implication |
| --- | --- |
| `src/hosts/verification.ts:39` | Host-invoked command wrapper observes exit, subject bytes and frozen command output; explicitly records `semanticSupportVerified: false` at `:77`. This is a useful transport receipt, not semantic execution evidence. |
| `src/kernel/workflow/verifier-contract.ts:8` | Optional contract is `{id,version,argv,files,checks}`. `contractResult` at `:47` validates emitted labels. It cannot distinguish a real reviewer from a program printing pass. Making only this contract mandatory is insufficient. |
| `src/kernel/workflow/service.ts:2112` | A contract is frozen only if supplied. `:2129` checks execution for `run_tests` steps; `:2218` grants structural `validated` while semantic support is false. `advance` at `:1075` succeeds once steps are succeeded/skipped. |
| `src/kernel/workflow/service.ts:1469` | Accepted/final promotion rechecks byte freshness and observed commands, then challenge rules. It has no required observed semantic-review predicate. |
| `src/cli/workflow.ts:189` | CLI `complete` rechecks `runExecutionProblems`, which only examines `run_tests` steps (`verification.ts:161`). |
| `src/kernel/broker/managed-delivery.ts:75` | Managed file-delivery work is completed from `state === succeeded`; it does not independently establish semantic review. |
| `workflows/research-brief/workflow.json` | The challenge step declares `model_review`, but a role/capability and submitted verdict do not constitute an observed reviewer invocation. The general carrier similarly cannot rely on its role names. |
| `src/kernel/delegation/service.ts:176` | Delegated review requires a successful implementation execution of the same work and exact path scope. That excludes ordinary artifacts produced directly by the native host. |
| `src/kernel/delegation/types.ts:35` and `adapters.ts:109` | Delegated worker results contain state, summary and findings. Empty findings plus success do not provide explicit coverage of each frozen material obligation. `workerSession` is generated internally (`service.ts:185`), not a parsed host session witness. |

## Smallest core contract

### 1. Freeze required obligations before production

Add a versioned `SemanticReviewContract`, distinct from `VerifierContract`:

- `required`, contract ID/version/digest, and the run/request identity;
- decision/use and permitted action scope;
- finite material obligations with stable IDs, plain-language criteria and their basis in the user's request or governing requirement;
- required coverage and evidence representations, plus the selected eligible verifier descriptor/version;
- declared limitation policy: unavailable coverage remains unknown/draft.

Do not have the final producer decide whether semantic review is required. The workflow/catalog supplies a structural requirement for decision-bearing research/recommendation deliverables, and typed intake supplies decision-bearing use for the general carrier. Unknown use cannot silently disable the gate. Host semantic interpretation is still reported interpretation; retain the original request and require the reviewer to assess obligation adequacy against it. A floor may be raised by declared stakes or challenge, but do not identify this requirement through fixture numbers, keywords, a skill name, or `run_tests` alone. All decision-bearing entry paths need the same frozen requirement, including general and custom carriers.

The initial obligations should cover source selection/currentness, decision-relevant calculations and units, material assumptions/uncertainty, contradictions and counterfactuals actually used, requested artifact, and action scope. Require magnitude only when the request or decision needs it. Do not impose formatting preferences as universal semantic failure. Freeze this prospectively; changes create a new revision/generation and cannot regrade historical receipts.

An eligibility descriptor is trusted host configuration/capability evidence, not a producer-created rubric that certifies its own checker. It identifies supported obligation classes, input representations, native transport, host/model/version, limits and permission evidence. An arbitrary argv program cannot nominate itself as a semantic reviewer. Model-dependent criteria cannot be discharged by a deterministic structural checker merely because it uses the same check IDs. Narrow deterministic verifiers can cover specifically declared computable obligations while semantic judgments retain semantic review.

### 2. Materialize the exact candidate and evidence generation

Introduce `prepareSemanticReview` in the workflow service as a data operation, not an executor. It assembles the same normalized final content that completion will publish, including handed-forward fields, requested file bytes and all named final artifacts. Refactor final-content materialization into a shared pure helper to prevent a review of one representation followed by delivery of another. Exclude only receipt bookkeeping to avoid a digest cycle; include every user-facing substantive field.

Produce a bounded immutable `ReviewBundle` with:

- run/step/attempt and a fresh generation identity;
- frozen request/action boundary and semantic contract digest;
- canonical artifact manifest (identity/path, byte digest, complete held bytes or typed immutable representation) and final-body digest;
- source manifest containing every admitted material source, exact held content, provenance, source observation/revision identity, completeness and supersession/authority metadata;
- source-generation digest, and relevant method/rubric versions when their criteria apply;
- explicit absent/partial/unavailable evidence and public execution observations only where a process claim needs them.

The source closure cannot be only citations the producer elected to include: include named/admitted source inputs and governing records, and let the reviewer flag omitted support or contradictory records. Do not widen source access; unsupported external claims remain unknown. Preserve `reported` versus `witnessed` provenance rather than laundering connector reports into independently witnessed sources. Material content truncation prevents coverage unless a deliberately bounded obligation can be resolved from a complete relevant slice with its parent identity retained. Reject unresolvable or unsupported artifact types instead of hashing an empty approximation.

Review an immutable copy, never a mutable project path. At completion re-resolve both artifacts and sources and compare with the bundle. Existing inherited evidence and source fingerprints are useful foundations (`verification.ts:66`, `:87`; `source/service.ts:424`), but current `ContentReceipt` omits source-generation/currentness metadata and does not itself reject truncation. Equal provider timestamps alone never mean equal bytes. Keep intentional edited input baselines separate from current supporting sources. Existing evidence-generation invalidation (`workflow/service.ts:1252`) should also invalidate affected review receipts rather than repinning them to a new generation.

### 3. Record adapter-observed review

A host adapter accepts only a prepared review ID/bundle and an eligible explicitly available native reviewer. It returns a receipt reference to the core. Neither `submit_work` nor generic review/command JSON accepts an asserted receipt as evidence.

The receipt binds contract, complete bundle, artifacts, source generation, run, step and attempt. The adapter—not model output—records invocation ID, host/model/config identity, observed terminal status, timeout/cancellation/permission failures, timestamps, bounded result digest and actual host session ID when exposed. The receipt also records the fresh independent invocation boundary. A native host without a reliable session identifier needs equivalent adapter-observed process/session isolation evidence; do not substitute a UUID echoed in a prompt as a host witness. Until that evidence exists, its adapter cannot establish the required independence.

The review result must give exactly one `pass | fail | unknown` judgment per frozen obligation, specific public reasons and relevant artifact/source references, coverage limits, and material findings. A successful process with no findings is insufficient. Missing/extra/duplicate checks, malformed/truncated terminal output, unresolved cited evidence, a failed material check, or missing mandatory coverage cannot pass. The kernel checks shape, identities, coverage, status, consistency and freshness. It does not pretend to validate the model's reasoning. Receiving the complete bound packet and an actual observed review response establishes observed review, not certainty that every sentence was understood.

Exclude private reasoning and the producer conversation. Use the existing public-observation projection only within its declared coverage: a web attempt does not establish retrieved result content. Source and candidate instructions are untrusted. The result must not inherit approvals or authorize actions.

## Feasible native adapter boundary

Prefer a narrow host-invoked `run review` operation, analogous to the existing command wrapper, with fixed adapter-owned arguments and a prepared bundle. No arbitrary `--command` is accepted as semantic review. It runs within the invoking host's current execution boundary. The kernel/MCP data service only prepares and validates; it does not silently launch a model or consume a new budget. If an existing native host delegation API supplies an independently observed fresh result, an adapter may translate that result under the same receipt contract. A model relaying another thread's alleged answer is not that transport.

Codex already has a suitable observed JSON-invocation pattern in `src/hosts/skill-native-evaluation.ts:48`, including real session/completion events. Extract narrowly reusable observation/parsing rather than making managed completion depend on skill qualification suites or their producer runtime. Cursor has a native structured CLI entry in `delegation/adapters.ts:57`; extend its parser to retain the actual invocation evidence and per-obligation result rather than asserting parity from the shared `WorkerResult` shape.

Reuse the delegation timeout, cancellation and permission/config checks where applicable, but not its implementation-first subject constraint, patch integration, or generic finding dispositions. Add a fixed artifact-bundle review subject if sharing that layer. A rejected finding by the producer cannot erase a frozen failed semantic check; a repair requires a fresh review of the resulting generation.

Do not auto-enable general delegation, add approval-bypass flags, move execution to a less restricted background MCP process, alter global settings, inherit grants/tokens, install another runtime, or fall back to another model/provider. Read-only review should not need broad project-write/delegation integration permission. Existing native login locations remain host-owned. Installation/authentication alone are not proof of permission containment. If safe native review is unavailable, return a concrete unavailable reason and preserve the draft.

## One completion predicate, multiple callers

Implement `runCompletionProblems` (or equivalent), including required structural checks, command checks and `semanticReviewProblems`. Call it for:

1. final step submission and every `advance` transition to `succeeded`;
2. structural-to-validated promotion where the run requires semantics;
3. accepted/final promotion, before asking and again when applying the person's answer;
4. CLI/scheduled `complete` responses and legacy run readout;
5. managed-delivery settlement and public completion of work explicitly associated with that managed-delivery scope.

Do not impose this on unrelated generic ledger items. Do prevent manually completing the same managed-delivery item through generic `work complete` from becoming an alternate managed-success path. Existing terminal/legacy rows without the required witness should remain historical records but report incomplete/unverified under the new completion policy; do not mint retroactive evidence.

Do not route `semantic_required`, missing execution/coverage, or stale generation through the existing ordinary validator waiver into accepted semantic success. If the person chooses to take delivery despite a failed/missing review, record explicit unverified-draft disposition without satisfying the semantic contract. Keep acceptance authority separate from evidence. `noData`, skipped steps, empty artifact sets, a challenge heading, a method report and copied `passed: true` must not bypass the requirement.

Recheck generation under the completion transaction for database-backed sources and immediately around the transition for external file state, using the same held snapshot. File edits cannot be made transactional by SQLite; preserve reservations and recheck at every later promotion/readout. Do not overstate protection against arbitrary concurrent filesystem mutation or out-of-band local database tampering.

## Adversarial acceptance tests

| Test | Required result |
| --- | --- |
| Omit semantic contract on a decision-bearing general/research/custom carrier | Production cannot silently reach accepted completion; missing requirement is reported. |
| `echo pass`, frozen self-written semantic checker, producer-submitted review object, invented review ref | Command may be observed; semantic gate remains unsatisfied. |
| Fresh reviewer gives overall success but one check is fail/unknown/missing/duplicated, or coverage mismatches | Block semantic completion; preserve exact result. |
| Review a correct recommendation with an incorrect counterfactual or unsupported assumption | Relevant material obligation fails even when the headline recommendation is correct. |
| Correct yes/no comparison omits an optional difference; sizing request omits required magnitude | First may pass; second fails the request-specific obligation. No fixed fixture answer in production code. |
| Edit artifact, handed final body, file alias target, source bytes under unchanged timestamp, authority metadata, rubric or method criteria | Old receipt becomes stale. Corrected source requires reread/rederive and fresh generation review. |
| Review intermediate source/artifact then add final delivery artifact or modify content in a later record step | Completion requires review of the actual delivered set/body. |
| Reuse receipt across runs, attempts, sources, contracts or producer/reviewer contexts | Reject even if filenames/check labels match. |
| Retry identical dispatch; revoke lease/cancel during review; late result; quota/permission denial; incomplete stream | Idempotent bounded invocation; no usable success after cancellation/lost authority; draft remains. |
| Input asks reviewer to ignore rubric or announce pass; producer chat/private reasoning included in events | Treat embedded instruction as data; private material excluded; result still evaluated under frozen contract. |
| Unavailable native adapter, truncated/unread source, unsupported artifact, web attempt-only evidence | Honest unknown/unavailable; no fallback or permission expansion. |
| `noData`, skipped final stage, ordinary waiver, generic work completion, legacy success row, CLI firing replay | None creates managed semantic success without the same current receipt. |
| Native Codex and Cursor permission probes | Exact shipped version/config denies writes, recursive launch, unapproved external access and sandbox escape; timeout/cancellation ends process tree. |
| Cross-host and same-host independent review | Core contract identical; actual fresh invocation is witnessed; same model is disclosed, not represented as model diversity. |

## Blockers and rollout

No blocker prevents implementing the core contracts and sterile tests now. Actual native semantic acceptance remains blocked until the enabled host adapter has live evidence for its exact permission and event contract, and until the new result schema demonstrates complete obligation coverage. Existing delegation documentation explicitly says synthetic tests are not a verified three-tool release (`docs/bounded-delegation.md:3`). This review did not inspect personal enablement or run such probes, so it makes no availability claim for this machine.

The material implementation decisions are: typed decision-bearing classification across the general/custom carriers; final-body materialization before review; complete evidence representation and source-generation identity; and reliable fresh invocation observation for Cursor. These are design requirements, not reasons to weaken the gate. Start with supported held text artifacts and explicitly block unsupported formats. Native platform integrations can follow the same contract without modifying the kernel's authority.

Deliver in coherent slices: (1) required contract and final-generation gate, with negative tests and honest draft reporting; (2) prepared bundle and receipt validation; (3) Codex/Cursor host adapters plus fixtures; (4) separately authorized live permission and semantic trials. During slices 1–3, required outcomes without a usable adapter stay unverified. Do not enable a structural substitute merely to keep success green.

The enforceable guarantee is that managed success cannot occur through supported APIs without a current, covered, actually observed semantic review. It is not cryptographic attestation against a user who controls the local database/process, and it is not universal correctness. No signing change is needed for this scoped guarantee.
