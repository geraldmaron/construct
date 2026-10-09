# Standalone Construct implementation and pressure tests

Started from commit `4c1d368cc260e813a7aa040ee563f380b2416554`. The [intake](../intake-2026-10-09/README.md) remains a historical baseline. This plan is not a completion claim.

## Scope and boundaries

Implement the admitted intake work in bounded slices. Preserve concurrent changes. No push, merge, publish, deployment, production data or external messages. Models and sandboxes remain owned by the host. An executor must exist for work to continue after a session exits. No private credentials are copied into fixtures.

Core owns run admission, scoped permissions, durable state, immutable evidence identities and dependencies, skill activation records, verification and trust transitions. Adapters own host availability, tool inventory, actual source access and model execution. A skill file is guidance; its presence cannot prove activation or enforcement. Unsupported host modes must say so.

## Ordered slices

1. Detect corrected bytes despite unchanged provider revision or file timestamps. Preserve explicit weak sightings. Cover dependent artifact invalidation and negative controls.
2. Report configured, observed and unavailable capabilities separately. Make native host loading observable. Remove generated dependence on a development checkout or accidental global command.
3. Bind verification receipts and skill activation/application records to artifact and method identities. Structural citation validation must not claim semantic support or actual test execution.
4. Add bounded discovery, reference-hop evidence and source coverage contracts, with progressive context and relevant dependencies. Keep external content untrusted and permissions scoped through every hop.
5. Bind schedules to real executors, occurrence identity, retries, cancellation and observable completion. Demonstrate continuation after the originating session ends, or report the unsupported contract honestly.
6. Install a packed standalone build into fresh synthetic projects and execute held-out SSO PRD, Harbor correction, incident/change-impact and scheduled-follow-through journeys. Repeat live consumer trials and assess invariants and resulting state, not an exact tool sequence.

## Adversarial controls

Exercise irrelevant and contradictory sources, prompt injection, permission denial and revocation, inaccessible references, traversal loops, changed schemas and units, stale timestamps, partial coverage, interrupted execution, retries and deduplication. SSO lenses are justified by product evidence: identity/security/privacy, accessibility/UX and operations, plus legal/compliance only with explicit jurisdiction, contract or control triggers. Unknown facts remain questions; no invented legal conclusions.

## Validation and current limits

Run targeted meaningful regressions per slice, then lint, typecheck, the full suite, packaged smoke and all-host conformance. Run actual consumers with ordinary user prompts and evaluator-only rubrics. Keep fixture support processes bounded and clean up exact owned processes.

The earlier native Harbor consumer produced correct initial and corrected recommendations but registered no Construct lifecycle or source state. Its initial tool inventory was unavailable, so this is not proof that the model ignored an available server. The local Codex CLI has an existing ChatGPT subscription login; clean CLI trials can ignore user configuration without copying credentials. Work Cloud with local execution does not guarantee local MCP or hook support: [official host documentation](https://learn.chatgpt.com/docs/extend/mcp). Admission enforcement therefore requires a verified host adapter or a first-party entrypoint.

Current standards inform minimal contracts, not a framework rewrite: [Agent Skills activation](https://agentskills.io/client-implementation/adding-skills-support), [MCP discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [PROV data model](https://www.w3.org/TR/prov-dm/), [OWASP injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). New protocol support must be negotiated; publication of a specification does not demonstrate support in installed clients.

## Implementation checkpoint

Implemented content invalidation: each directory refresh hashes actual bytes, including large files with bounded memory; unchanged size/mtime no longer certifies unchanged content. Contained directory loops are visited once, concurrent read failures preserve the old snapshot, and a capped inventory is refused instead of presenting unseen files as deleted. Host reports include observed content in their fingerprint even when the provider timestamp or fingerprint is unchanged. Explicit weak sightings preserve full reads; a strong observation containing new information invalidates dependent conclusions.

Removed unsupported skill qualification: a current lock plus filenames of activation/behavior cases now remains experimental. This is a truthful limit, not implementation of execution-based qualification or composition.

Source slice validation: full suite had 812 passing tests, zero failures, one skip; lint, typecheck, packaged smoke passed. All-host static conformance: 91 passed, zero failed, seven untested. Those seven remain untested live-host cells. Targeted checks after the qualification correction passed. Full final checks are recorded in the local checkpoint evidence, not inferred from these earlier results.

The first fresh SSO trial fixture is LatticeDesk: current no-SSO architecture, tenant memberships, SAML customer need versus OIDC proposal, stale roadmap, session-revocation correction, inaccessible contract, privacy/accessibility/operations context, irrelevant Slack and a malicious pasted attachment. The evaluator rubric is outside the consumer project. The prompt is simply “Write a PRD for adding single sign-on to LatticeDesk. Save it as sso-prd.md.” No rubric or instructions naming Construct are appended.

Two preliminary consumer runs did not qualify as lifecycle tests: isolation omitted project configuration in one; a fixture copy dereferenced the package executable symlink in another. These are harness failures, not evidence of an unavailable product capability. A real fresh npm installation then exposed all Construct and synthetic-source tools in a native host inventory probe. Its ordinary-prompt consumer exercised bootstrap, classification, start, step claims/submissions and the native work ledger. Final artifact quality and evidence coverage still require assessment. The package under that consumer contains the source-correction slice; the later qualification-label correction is not in that tarball.

Remaining: capability admission/observations, executed verification and skill receipts, progressive source/context contracts, executor-bound scheduling, incident/change-impact and post-session trials, repeated independent live evaluation. The implementation outcome remains open. No push, merge, publish or deploy occurred.

The completed first SSO assessment and exact current checks are in [CHECKPOINT.md](CHECKPOINT.md). It failed substantive discovery despite a challenged deliverable. The observed typed-PRD routing defect is fixed and awaits a fresh live repetition.
