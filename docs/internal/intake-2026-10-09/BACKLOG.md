# Implementation-ready follow-up work

Parent outcome: **`work-18402da5`**, serving relayed outcome `st-70944f61`. This is a local intake, not authorization to deploy, publish, acquire credentials, or activate production schedules. Assessment task `work-346864a8` is separate so completing the assessment does not imply completing this program. Item receipts are retained in [native-work.json](evidence/native-work.json).

Final native evidence: both ordinary turns passed output/source-refresh checks, while Construct recorded no lifecycle or source observations. Prioritize V2 activation/readiness diagnostics first at the consumer boundary; pursue V1 verification and V3 invalidation fixes in parallel, then prove V4 executor delivery and enforce V9. Keep tool-loading failure distinct from model-routing failure. The native follow-up is not evidence that the kernel invalidation defect is fixed.

P0 means protect truthfulness and the claimed consumer outcome before expanding the promise. P1 means close context and method-quality gaps in the next bounded delivery slices. These priorities are recommendations, not a claim that every existing host must be supported immediately. Explicitly declare the supported set and mark the rest experimental.

| Key | Native ID | Change | Dependency order |
|---|---|---|---|
| V1 | `work-8a76ee30` | Executed verification receipts | Independent first slice |
| V2 | `work-4f056fec` | Observed capability and honest readiness | Independent first slice |
| V3 | `work-f9d4c249` | Content-driven source invalidation | Independent first slice |
| V4 | `work-411556aa` | Real recurring executor and durable state | V2; coordinate existing standing-chat and stakes work |
| V5 | `work-c0b5e1bd` | Source schema, identity and coverage contracts | V2 |
| V6 | `work-5ab0581a` | Outcome context and relevant-change dependencies | V3, V5 |
| V7 | `work-a8273a89` | Citation validity versus claim support | Independent; integrate V1 receipts |
| V8 | `work-98b4069f` | Executed skill qualification and composition | Independent; integrate V1 receipts |
| V9 | `work-d45349d5` | Enforced live outcome release gate | Gate mechanism independent; release criteria consume V1–V8 |

## V1 — P0: Require executed verification receipts

Evidence: P08 in [probes.json](evidence/probes.json); `verification_result` accepts an unaccompanied boolean. Entry points: `src/kernel/workflow/validators.ts`, workflow submission/promotion and schemas. Related: `work-a20bbe62`.

Implement a versioned verification record containing subject/artifact digest, source revision, verifier identity and version, invocation, start/end, exit/result, coverage and evidence references. A model-reported check can remain useful but must retain its weaker evidence status. Not every valid verification is a shell test: support content inspection or domain checks with a defined verifier and preserved observations. Bind the receipt to the actual output, not an arbitrary string equal to “current.”

Acceptance:

- Re-run P08: `{passed:true}` alone cannot produce execution-verified trust; return a specific missing-evidence remedy.
- A receipt for another artifact, revision or prior failed attempt cannot be replayed to promote the current output. Mutation after checking makes verification stale.
- A real command returning nonzero cannot pass even if the model supplies `passed:true`; preserve stderr/result without secrets.
- Public managed outcome with an actual successful check still completes. Distinguish structural, reported, execution-verified, challenged and person-accepted states in the returned UI data.

Risk: blocking legitimate non-code outcomes through a command-only schema. Keep pluggable verification kinds with explicit proof levels.

## V2 — P0: Report capability and readiness from observed access

New native evidence: [the Harbor task](NATIVE-TRIAL.md) read the installed operational skill and produced a correct output, but no Construct API activity or state was recorded. Diagnose initial configuration root, trust and actual tool exposure separately from model routing. Executing commands in a cwd is not proof that its project MCP configuration was loaded when the host started.

Evidence: P01; fresh doctor; clock CLI readiness discrepancy. Entry points: `src/cli/broker-context.ts`, capability registry, `doctor`, bootstrap and host adapters.

Separate declared, reported, probed and exercised capability. Each observed claim needs scope, principal/session, provenance and expiry. A generic host label must not satisfy an arbitrary scoped connector requirement. Report installation health independently from usable-session and outcome readiness. Clock mode must use the capabilities of its actual executor.

Acceptance:

- Empty inventory cannot satisfy Jira read or HRIS write; read-only sandbox cannot satisfy project writes; absent test executable cannot satisfy the requested check.
- A source with expired auth, partial scope, or denied probe becomes blocked/unknown without losing previous provenance. Reconnect does not inherit another user's authority.
- Fresh init on a machine with several hosts names the required next step. Doctor may pass installation but must explicitly leave live activation and source readiness unverified.
- Compare direct headless and public CLI preflight for the same request; they agree about missing executor capabilities.
- A trace explains why a capability was allowed or denied, when last observed, and how to recover without displaying credentials.

Risk: invasive probing. Use harmless read probes and scoped grants; never infer authorization from discoverability alone.

## V3 — P0: Invalidate dependencies when source bytes change

Evidence: U05 and separate-process local CLI test; `source/service.ts:368` and `hosts/sources/directory.ts:65`. Related: `work-26aad6b2` for versioned text storage.

Keep provider revision and observed content identity separately. A provider timestamp is useful metadata but cannot override a contradictory content digest. For local files, metadata may accelerate discovery but must not certify unchanged bytes without an appropriate guarantee. Define policy for oversized/uncertain reads; expose incomplete verification instead of false freshness.

Acceptance:

- Change API value, units and schema with constant `updatedAt`: detect the changed observation and invalidate affected deliverables/work premises.
- Write equal-length different bytes, restore mtime, exit process, refresh through installed CLI: detect change or return explicit unresolved freshness; never “unchanged” with verified freshness.
- Touch unchanged content: do not create a semantic change solely from mtime. Same source version with contradictory bytes raises a provider inconsistency.
- Partial/paginated report omission does not delete an item. Explicit complete-snapshot deletion does, with provenance. Large-file and file-count caps name unverified coverage.
- Exact repeat is idempotent; unrelated item changes do not stale every deliverable indiscriminately.

Risk: hashing cost and invalidation storms. Measure bounded reads and cache correctness; optimize after preserving the contract.

## V4 — P0: Bind recurring work to an executor and durable state

Evidence: [schedule.json](evidence/schedule.json), U08/P02/P03. Entry points: triggers, CLI schedule/fire/recipe, persistence and host executor adapter. Coordinate `work-126c336c` (define standing outcomes from chat) and `work-d3095144` (freeze stakes).

Define clock event, executor binding, state location, immutable approved intent, per-run capability/tier budget, concurrency policy, recovery policy and delivery destination. The generated recipe must be runnable from a fresh environment, or explicitly require a persistent worker. A cron expression alone is not activation. No daemon is mandated inside the kernel.

Acceptance:

- Install in a synthetic project, define an authorized schedule naturally through the supported host, close the originating session, deliver a verified local result through the provisioned executor.
- Fire from a fresh checkout: restore/locate correct trigger state or fail with a truthful setup blocker; never advertise active automation with no executor.
- Repeat event keys and simulate crash after a write: no duplicate external effect; preserve an operation id and receipt. Different scheduled outcomes have a documented overlap policy.
- Test delayed/missed ticks, timezone/DST, revoked access, exhausted budget, worker death, pending user decision, cancellation and disabled trigger.
- Emit queued, leased, running, waiting, failed and delivered timestamps with reasons. No “started successfully” ambiguity when only a database row exists.

Risk: background authority and uncontrolled spend. Default local result delivery, bounded budget and explicit capabilities; require authorization for external effects already required by the product.

## V5 — P1: Profile source schema, coverage and identity explicitly

Evidence: actual controlled API/MCP reads needed manual bridge reporting; no adaptive schema contract. Entry points: source connector/service/manifest and host reader bridge. Coordinate `work-f41e18f4` (capture beyond Jira/Claude).

Specify a transport-neutral observation envelope: discovered operations/resources, input/output schema, principal, source identity, stable item identity, schema/content/provider revisions, units, timezone, coverage/cursor, deletion semantics, freshness, authority and sensitivity. Discovery can use OpenAPI, MCP schemas, or local inspection; unavailable schemas are explicit uncertainty. Do not require an exhaustive built-in connector library.

Acceptance:

- Controlled API, MCP server and local files can be discovered through their respective adapters and associated with the same outcome without hard-coded Jira assumptions.
- Paginated, rate-limited and permission-filtered responses declare their observed coverage; access denied, empty result and deleted item are distinct.
- Add optional field, remove required field, rename identifier, change units and collide identifiers across sources. Compatible additions proceed; incompatible meaning blocks affected computation with a mapping question.
- Malicious tool descriptions and source content cannot alter project permissions, execute code, or mark themselves authoritative.
- Source configuration and stored observations redact secrets and support retention/deletion without destroying the existence of an audit event.

Risk: inventing a universal business ontology. Keep transport facts separate from domain mappings and human authority.

## V6 — P1: Assemble outcome context and relevant-change dependencies

Evidence: topic-level context retrieval, fixed underlying caps, graph-limited drift. Entry points: context tools, repository material, source dependency and drift modules. Coordinate `work-ee0bd087`, `work-ddfc7176` and existing multi-repo work.

Return a bounded, versioned context packet for an outcome: request/intent, current decisions and supersessions, authority/conflicts, sources and coverage, relevant work/artifacts, dependencies, unknowns and omitted material. Add continuation instead of losing older matches. Change subscriptions record what matters and why; a model-proposed semantic link remains reviewable evidence.

Acceptance:

- Place the relevant decision beyond current retrieval caps and outside recent activity; an outcome query still finds it or offers a continuation with an honest completeness indicator.
- Superseded decisions do not override current ones; unresolved authority conflicts remain visible. Contradictory sources are not merged into fabricated consensus.
- A relevant unit/schema/requirement change marks affected output or work stale; unrelated source change does not. Evaluate precision and recall with labeled fixtures.
- Resume in another allowed host with the same durable state: reconstruct why work stopped and what evidence is still current without relying on hidden chat memory.
- Team claims show owner, lease, dependency and unresolved decision; cross-repository identities cannot collide. Distributed synchronization remains a separately declared deployment contract.

Risk: token growth and false relevance. Include a budget, selection reasons, omitted counts and expandable citations.

## V7 — P1: Separate citation validity from claim support

Evidence: U02/P07 contradiction passes; P06 correctly distinguishes reported evidence. Entry points: `check_answer`, evidence model and verifier adapters. Related: `work-a20bbe62`.

Keep deterministic ref/excerpt/number checks, label what they establish, and add an explicit claim-support/contradiction assessment where the outcome requires it. Preserve inference, uncertainty, source independence and authority. Do not promise perfect semantic truth from another model call.

Acceptance:

- Source says “does not store passwords”; answer says “stores passwords”: citation may resolve, but supported-answer state must fail or be flagged.
- Paraphrase that preserves meaning passes; a quotation outside context does not establish the asserted conclusion.
- Two independent sources disagree; output retains both observations, scope/time differences and an unresolved or justified resolution.
- A host-reported `.invalid` URL fixture remains reported, never network-witnessed. A forged source instruction cannot promote authority or approval.
- Answer-only requests remain lightweight and do not create unnecessary managed work.

Risk: false certainty from semantic grading. Publish error cases and support status; allow “cannot determine.”

## V8 — P1: Qualify and compose skills from executed evidence

Evidence: P09; registry qualification filename logic; doctrine freshness notes. Entry points: registry qualification, method/workflow schemas and live evaluation runner. Coordinate `work-c0534a5f` and `work-6dbecd9f`.

Qualification requires executed records bound to skill/workflow digest, verifier, host/model, date and coverage, with expiration/requalification on change. Select methods by actual uncertainty and outcome needs, including composing research, requirements, domain review and adversarial checking. Use input/output contracts and a bounded plan; do not require every user to name skills.

Acceptance:

- Manifest with activation/behavior filenames but no passing execution records remains experimental.
- Positive explicit, positive implicit, contextual, negative/no-op and unfamiliar-domain prompts run from fresh sessions with held-out variants. Record invocation, loaded methods, sequence, output quality, cost and latency.
- One request genuinely needs research plus a specialist review; methods exchange a typed evidence-bearing artifact. A simple factual question does not trigger the whole organization.
- Changed skill digest, expired doctrine or incompatible source contract causes requalification/research or a bounded blocker, not stale “qualified” status.
- Compare a host-native baseline to Construct for the same outcome; record regressions, not only best examples.

Risk: evaluating only routing or writing expensive self-confirming evaluations. Human-labeled failure cases and independent checks must constrain quality claims.

## V9 — P0: Enforce fresh-host outcome evidence in release gating

New native evidence: the Harbor artifact passed its withheld content rubric and real API/MCP reads were witnessed externally, but Construct orchestration was absent. Keep separate release cells for host answer quality, source transport use, tool exposure, Construct activation and durable lifecycle. Do not count this outcome as successful Construct routing.

Evidence: live check fails while publishing workflow omits it. Entry points: `.github/workflows/release.yml`, `scripts/evals-live.mjs`, release record schema. Existing live-run collection is **not duplicated**: `work-bd929e5b`, `work-c0534a5f`, `work-b2dbb067` own those experiments; this item enforces their results at release.

Acceptance:

- Release dry-run fails when required live records are missing, stale, from another digest, incomplete or contain unresolved failing cells.
- A static configuration/conformance pass cannot substitute for a live outcome. A blocked/unavailable host is visible and excluded from supported claims, not silently passed.
- Consumer tests start with published tarball/empty profile, no skill hints, real source fixtures and no hidden preseeded Construct state. Cover first question, outcome, denied access, changed schema, interruption and post-exit recurring execution.
- Preserve attempts and reruns; publish denominator, host/model/version, sampled cases, failure reasons and limits. Quality criteria include correctness, unwanted activation and delivery, not tool invocation alone.

Risk: unreliable paid live tests can block releases spuriously. Use repeatable fixtures, small declared supported matrix, bounded reruns and explicit quarantine policy; never convert missing data to success.

## Reconcile existing work without rewriting it

Keep `work-126c336c` for chat standing definitions; V4 supplies the executor lifecycle that chat alone cannot provide. Keep `work-f41e18f4` for verified read capture; V5 supplies generic source contracts. Keep live-host tasks for data collection; V9 enforces release evidence. The native parent links the earlier typed-intake, context and substantive-validator programs so these slices can be reconciled without duplicate epics.

Continue existing person-elicitation checks (`work-5ef4f2f8`), source access boundaries (`work-dcd78ed1`), immutable GitHub citations (`work-24e52203`), multi-repo identity/provenance items and independent challenge (`work-148001f8`) where their acceptance remains unmet. Update `work-7c93076f` by negotiated supported protocol contract rather than blindly treating its older named MCP version as current.

Potentially stale items concerning already-replaced statements or existing doctor/hook behavior need a focused recheck before closure (`work-1991b3a4`, `work-ab70d877`, `work-cdd33485`). No bulk closure was performed. Legacy live Jira/global-store migration rows should be evaluated against the new contract and user outcome, not preserved for compatibility alone. No predecessor item was silently deleted or marked done by this intake.
