# Portable Construct outcomes: implementation and qualification record

Local mechanisms are implemented and verified. Ordinary-prompt effectiveness and method contribution remain unqualified because native preflight did not establish isolation. This is an engineering record, not release qualification or user acceptance.

## Continuity and result

Continued from the initial [alpha audit](../AUDIT.md), its source-schema correction, and the saved October delivery failures. The clean starting commit was `904e29aa`, on `dev/fresh-delivery-reliability`. Previous failures remain evidence; a green mechanism test does not replace them.

The existing SQLite state, source admission, workflow resolver and work ledger remain the implementation. No dependency, resident service, model download, paid endpoint or additional agent runtime was added. Existing format-5 stores gain only rebuildable auxiliary search tables; they need no canonical-state migration. The local registry lock was reconciled through `node bin/construct.mjs skill update`.

## Behavior and interfaces

- `classify_request.intent` captures outcome, audience, acceptance, constraints, assumptions, prior work and an execution path. The current host performs interpretation; the kernel checks and freezes it. Workflow `execution` metadata declares the path, checkpoints, evidence obligations, gathering limit, stopping conditions and required assurance. Exact deliverable or explicitly named workflows retain precedence.
- The default general carrier is `guided-outcome`; `decision-support` binds decision framing. Existing research, review and implementation paths are reused. Generic artifacts and advice require no file writer or code-test runner. The command-verified implementation alternative remains explicit.
- `context_search` ranks admitted passages with FTS5, exact lookup, bounded host query expansion and explicit relationships. Result items include citations, revisions, provenance, status, freshness, authority and coverage gaps. Serialized items honor the declared character budget; diagnostics are separately capped. Read-only connections build an ephemeral index and refuse a read whose database generation changed.
- `context_index` inspects/rebuilds the cache and explicitly configures or disables supplied embeddings. Vectors bind model, dimensions, `embeddingRef` and the exact returned passage digest. Incompatible and obsolete vectors are refused or discarded. Construct performs no embedding inference or service call. The default works with vectors disabled.
- Directory refreshes now retain bounded redacted text of supported files as witnessed evidence. Private host/credential directories and named credential files supply no retained text. Binary/unsupported and truncated representations stay visible in coverage. Existing sources obtain the new representation on refresh; full-byte fingerprints still detect unchanged-timestamp corrections.
- `snapshot:<encoded snapshot id>:<encoded item id>` resolves immutable captured text without restoring revoked access. Historical use must be explained under `historicalEvidence`; current work is invalidated when its consumed generation becomes historical. Remembered decisions provide actual stored text for quote and figure checks, with record status/origin retained.
- Method reports can map obligations to existing output sections and project evidence, with separate procedure-only doctrine references. These remain host reports; their presence establishes neither semantic support nor method benefit.
- `checkpoint_work` stores bounded partial progress on the current lease, existing permitted local artifact receipts, unknowns and remaining actions. It grants no completion or trust. Gathering counts are host-reported, not witnessed enforcement over arbitrary host tools. Existing cancellation/replanning preserves completed work and requires reconciliation rather than replaying effects.
- `run_status` separates delivery, recorded deterministic checks, semantic review and person acceptance. Structural paths complete without an independent reviewer while retaining `semanticSupportVerified: false`. Required-review paths still hold their exact draft. The kernel review identity is host-neutral; executable restrictions remain inside the native adapter. The exported reviewer observation boundary requires the bound dispatch, profile, held bundle and current lease; same-session review cannot establish independence. Other native reviewer implementations remain unqualified.
- Bootstrap and doctor distinguish the index, available capability and recorded outcomes from actual outcome readiness. Installation is not an effectiveness claim.

The public kernel entry exports retrieval and intent/review types. `@geraldmaron/construct/reviewer` exposes the trusted adapter observation contract; deep kernel/host package paths remain closed. Generated documentation and registry indexes describe the same shared interfaces. Shipped operational instructions apply the procedure to every supported host.

## Verification

Exact observations and log hashes are in [checks.json](checks.json). Each command ran; initial sandbox socket/process/cache restrictions were resolved without weakening their tests.

Check: project lint and generated-interface parity
Command: `npm run lint`
Result: pass
Observed: existing lint and generated registry/reference checks passed; host schema/description budgets were retained.

Check: public and stored TypeScript contracts
Command: `npm run typecheck`
Result: pass
Observed: no type errors.

Check: the complete regression path
Command: `npm test`
Result: pass
Observed: see the executed counts in checks.json; skipped coverage remains explicit.

Check: fresh packaged installation and public CLI/MCP delivery
Command: `npm run smoke`
Result: pass
Observed: an installed scratch project retrieved ranked admitted evidence, preserved historical citations, rejected their silent use as current support, saved a checkpoint and completed portable chat delivery with explicit structural assurance. The earlier required-review draft was still protected from promotion.

Check: each supported host's shared protocol and wiring
Command: `npm run conformance`
Result: pass
Observed: every supported host exercised ranked context and portable delivery/checkpoints in addition to existing wiring and trust checks. Native host cells remain untested as stated in checks.json.

Check: frozen retrieval questions
Command: `node --test tests/kernel/broker/portable-outcomes.test.ts`
Result: pass
Observed: expected evidence was recovered within the serialized-item budget; the absent-answer case returned nothing. Fixed expansions test retrieval mechanics, not model inference. The diagnostic records recall, extra passages, elapsed time and host calls.

Outcome: A fresh consumer can retrieve admitted context, complete a grounded chat outcome without code-test/file-write capabilities, retain a checkpoint, and see assurance and acceptance independently.
Surface: Installed CLI and stdio MCP; shared protocol tests for all supported hosts.
Data: Synthetic source passages, corrected bytes under unchanged timestamps, a remembered decision, realistic work/run leases, an unsupported binary and a named credential file.
Observed: Packaged and shared-protocol scenarios delivered the result, retained evidence and checkpoints, refused invalid history/vector/review claims and left person acceptance unset.
Verdict: proven for these mechanisms; ordinary native-model effectiveness is not proven.

## Challenge before commitment

VERDICT: Accepted with controls

Steelman: This extends the existing operating layer with a bounded evidence-to-delivery path. Hosts retain reasoning and execution; the kernel retains provenance, exact bindings, evidence checks and trust transitions. Default usefulness does not require an embedding or reviewer service.

This is self-review; no independent review is claimed.

1. Strongest failure mode: a host treats an injected passage, method report or structural pass as authority. Relevance/data labels, historical acknowledgments, exact dispatch receipts and separate assurance/acceptance are controls; native artifact correctness still needs qualification. Serious residual.
2. Best alternative: bundle local embeddings and another planner. That could improve independent paraphrase recall but does not establish source support or reliable delivery, and adds a runtime/dependency this scope does not require. Optional vectors preserve that later choice.
3. Load-bearing claims: installation, retrieval, citations, checkpoints and structural delivery have executed public-surface evidence. Native completion, scale performance and method benefit are unsupported and are not claimed.
4. Assumption inversion: if a host ignores the portable procedure, method/gathering reports do not prove compliance. The frozen outcome and explicit limits expose that gap; ordinary-prompt trials must test it. If an embedding is absent, the default still functions. If a reviewer is absent, delivery remains structurally checked and semantically unverified.
5. Cost bearer: users pay in context, latency and mistaken conclusions. Bounded items/diagnostics, checkpoints and explicit source gaps control context cost; local tests introduce no paid dependency. Model access uses existing subscriptions only.
6. Hostile expert: the small synthetic retrieval corpus cannot establish semantic equivalence at organizational scale, and an application receipt cannot establish improved decisions. Preserve these limits and require an isolated native cohort before a release/effectiveness claim.

## Native isolation diagnosis and remaining work

Reproduction command: `npm run evals:live -- preflight --host=codex --model=gpt-6-astra`. Binary/version, absence of API environment and existing subscription authentication passed. The contamination canary failed: it reported connector tools beyond the fixture's configured server set. Earlier records already identified canonical native preflight as unfinished work.

Hypothesis: sharing the real configuration home for login is the sole contamination source. A scratch home with only a reference to the existing login removed the personal-instruction response but retained the foreign tool list. Verdict: refuted as a complete explanation. The remaining transport/context source is unexplained; no isolation fix or passing native cohort is claimed. Credential values were not copied or printed; machine credential/provider configuration was not changed, and no provider fallback was attempted.

The reproduction and whole public result were inspected. A full cause and a fix proven in both directions were not established. Keep the existing native-isolation and skill-qualification work open. Run ordinary-prompt delivery and the method/no-method comparison only after the canary establishes the intended boundary. Existing failed delivery cohorts remain the baseline. No publishing, release promotion, authentication change or new schedule was performed.

## Verification record

- Project inspected: answered: see Continuity and result ("existing SQLite state, source admission, workflow resolver and work ledger"). Interfaces and auxiliary stored shapes are named above.
- Reuse checked: answered: see Behavior and interfaces ("existing research, review and implementation paths are reused"). Searches covered the repo, installed skills, sibling vector/retrieval implementations and prior audit/session evidence; no second engine or embedding dependency was introduced.
- Validation path run: answered: see Verification ("Each command ran") and checks.json.
- Outcome observed: answered for public mechanisms ("Installed CLI and stdio MCP"); native effectiveness is not proven.
- Surface inspected: answered: protocol replies, actual artifacts, CLI output, empty/denied/changed-source cases and persisted state were inspected. No graphical product surface changed.
- Diff reviewed: answered: public contracts, trust boundaries, source retention, generated artifacts and tests were checked against the approved plan. Corrected concrete budget, citation and review-dispatch issues found in that review.
- Residual risk: native isolation, ordinary-prompt completion, method benefit and scale/general-language retrieval require the stated qualification; none is inferred from receipts.
- Adversarial-review: self-review, accepted with the explicit controls and qualification limits above.
- Root-cause-debugging: partial diagnosis; reproduced and hypothesis tested, complete cause and bidirectional fix not established.
- Commit-and-pr: local branch only; the change is one portable-outcome implementation, with no attribution trailers. No pull request or push is included.
