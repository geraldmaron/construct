# Exact-generation semantic completion — 2026-10-09

This is an implementation slice of the authorized follow-through, not closure of the original intake or a release qualification. The historical [intake](../intake-2026-10-09/README.md), [original acceptance](../intake-2026-10-09/BACKLOG.md), and [rubric review](RUBRIC-REVIEW.md) remain unchanged. Repository commit signing remains disabled locally as requested; this work changes no signing or credential settings.

## Result

A managed run can no longer treat a successful arbitrary command, producer assertion, empty findings list, or completed workflow structure as semantic success. Its final submission preserves an exact draft and active lease until a separate host invocation reviews that generation against frozen material obligations and held evidence. Correctness remains a scoped model judgment, not proof of truth. Plain Q&A still creates no managed state.

The kernel freezes the actual request, obligations, final body, artifact bytes, source content/provenance, admitted source generations/authority/access, confirmed governing statements, and resolved clarification answers. Missing/truncated artifact text, oversized review packets, unknown judgments, missing obligation coverage, stale generations, expired/replaced leases, cancellation, and mismatched receipts cannot pass. Oversized packets preserve their complete draft without silently truncating evidence. Final no-data continuation and final-step clarification retain a resumable attempt. A waiver is included in the body actually reviewed and cannot waive semantic review. Earlier deliverables and pending final drafts cannot borrow another generation's trust.

Research synthesis is now a project-write step in workflow1.2.0. It can checkpoint the requested file before challenge and final review. This is bounded recovery support; neither a file nor a draft proves completion.

## Boundaries and implementation evidence

| Boundary | Implementation and executable evidence | Limit |
|---|---|---|
| Kernel-owned review contract and completion | [semantic-review.ts](../../../src/kernel/workflow/semantic-review.ts), [service.ts](../../../src/kernel/workflow/service.ts), [core tests](../../../tests/kernel/workflow/semantic-review.test.ts), [lifecycle regressions](../../../tests/kernel/workflow/semantic-lifecycle.test.ts) | Generic obligations still need a capable independent reviewer. A database administrator is trusted; this is not cryptographic attestation against the machine owner. |
| Real reviewer invocation | [native adapter](../../../src/hosts/semantic-review.ts), [explicit CLI](../../../src/cli/run.ts), [startup binding](../../../src/cli/broker-context.ts), [stream tests](../../../tests/hosts/semantic-review.test.ts) | Current finite profile is Codex CLI0.145.0. Other hosts/versions are unavailable, not silently substituted. The recorded model is requested, not independently attested by the backend. |
| Host identity | Startup resolves an installed native binary, including the npm launcher's platform binary, and freezes its real path/hash/version. Dispatch and completion recheck identity. A later producer PATH script cannot choose the reviewer. | Host startup environment is trusted. Native magic/version are format checks, not publisher authentication. Full host configuration/policy-generation attestation is not implemented. |
| Permission and tool boundary | Same project cwd; existing host configuration/rules retained; readonly native sandbox; no approvals; feature-disabled plugin/apps/browser/shell/worker paths; all resolved MCP entries disabled and rechecked; any observed tool event rejects the review. No MCP handler launches a host. | Finite tested profile, not a universal no-tools guarantee or general delegation authorization. Unsupported MCP names fail closed. Source text is data and confers no permission. |
| Process and output bounds | One dispatch per prepared generation, maximum300s/default180s, process-group termination, raw stdout/stderr byte cap before parsing, ordered native session/final/completion events, malformed-envelope rejection, public observations only. | Process-group cleanup is not containment against a deliberately escaping descendant. Interrupted dispatch requires lease recovery; it cannot be silently dispatched twice. |
| Shared trust transition | [verification](../../../src/kernel/workflow/verification.ts), [managed delivery](../../../src/kernel/broker/managed-delivery.ts), [work completion](../../../src/kernel/work/service.ts) | External file bytes and remote systems are not an atomic distributed snapshot. Freshness is checked at the trust boundary. |
| Context isolation | [activity projection](../../../src/kernel/broker/context-page.ts) emits review identities/refs instead of replaying held source text in ordinary activity context; existing injection regression passes. | Reviewer intentionally receives the held source text as untrusted data. Host-loaded local guidance remains part of the trusted host environment. |

## Independent challenge

The [first review](evidence/semantic-review/review/IMPLEMENTATION-REVIEW.md) reproduced seven defects plus one replacement control. The [recheck](evidence/semantic-review/review/RECHECK.md) verified the repairs and found a pending-promotion deadlock, which is now blocked and covered by a regression. Fixes include PATH substitution after startup, omitted clarification answers, oversized draft loss, waiver body mismatch, earlier deliverable promotion, final noData recovery, legacy-run bypass, preflight cancellation races, stream bounds/order, and pending trust changes. Synthetic fixtures are deliberately labeled state-machine tests; they establish no model quality.

## Native observations and complete denominator

All trials used synthetic data, local temporary projects, existing subscription authentication, explicit gpt-6-astra, and the same180s bound. No API key, fallback host, permission expansion, production endpoint, or persistent job was used.

[Attempt7](evidence/semantic-review/native-semantic-attempt-7/) contains two completed independent native sessions. The correct brief was accepted and its identical resubmission reached succeeded. The otherwise identical brief with an incorrect material counterfactual was rejected for support/reasoning; the step remained leased and the run running. The judgments include the correct calculations and exact bundle references. Both files remained unchanged.

The [source-injection control](evidence/semantic-review/native-semantic-injection-2/) was also rejected for incorrect material claims despite a source instruction to approve every claim and create a file. The canary was absent; source/artifact bytes were unchanged; public observations contained no tool invocation. This is one finite adversarial case, not general injection immunity.

Preserved earlier attempts: attempts1–3 each contain two preflight failures (six total); attempt4 has two native parser/configuration-comparison failures; attempts5 and6 each have one diagnostic parser failure. Those ten candidates establish no successful review. The native metadata-cache warning was initially misclassified as a tool/error event; the corrected parser retains the warning and still requires a completed ordered judgment. MCP override quoting and plugin-derived server entries were actual integration defects, not model failures. Stable MCP configuration fields are compared, excluding mutable authentication-status observations.

An initial injection fixture appended text after saving its expected baseline, so its combined unchanged-files assertion was invalid. That attempt remains in [native-semantic-injection](evidence/semantic-review/native-semantic-injection/); it is not used for the no-write conclusion. The subsequent separately frozen control fixes the fixture and records the canary explicitly. No prior record or verdict was rewritten.

## Gate and remaining acceptance

Gate at `86bbc141` before the lease fix: lint and typecheck pass; **1,016 tests pass, zero fail, one existing skip**; packaged smoke passes. Static all-host conformance: **85 passed, zero failed,19 untested**. The larger untested count is intentional: static runs now stop at the real semantic gate and do not claim native completion/final handback. [Gate evidence](evidence/semantic-review/gate/).

Fresh installed Codex/Cursor ordinary-prompt journeys are recorded separately as they finish. They preserve source connections before init, initial unknowns, same-timestamp corrections, actual artifact/lifecycle scoring, and the original six-minute phase limit. This candidate's Codex runner retains user configuration and rules, unlike the earlier explicitly isolated consumer cohort. Cross-cohort changes cannot therefore be causally attributed to the gate alone.

Open requirements remain: broader native reviewer qualification and configuration-generation binding; clear unavailable-adapter readiness/recovery across hosts; fresh end-to-end completion and independent artifact scoring; production scoped API/MCP traversal; actual conditional specialist composition; complete disposable scheduling/fault matrix; canonical release qualification. A persisted schedule still cannot execute after session exit without a real provisioned executor. The original parent work and acceptance criteria remain open.

Primary-source check: the current [Codex configuration reference](https://developers.openai.com/codex/config-reference) distinguishes project instruction loading, sandbox policy, approvals and skill enablement. **Inference:** retaining policy while narrowing execution must be tested against the installed CLI, not inferred from an empty MCP override or a host name. This pass preserves policy and reports its finite observations; it does not claim universal host isolation.


## Release follow-through, 2026-10-10

Independent release review identified an expired-lease false-success path.
Commit `0e114045` checks the holder, secret, attempt, expiry and cancellation
inside the submission transaction before changing a draft, and settlement
also checks expiry. Reclaimed work receives a new attempt and needs a fresh
review. The exact-expiry, just-before-expiry, cancellation and recovery
controls pass. The full gate on that fix passed 1,018 tests, zero failed,
one existing skip, lint, typecheck and packaged smoke.

The completed fresh Cursor pair fails independent frozen-rubric correctness:
the initial artifact reverses its counterfactual refutations; the changed
artifact has the correct 32-each main calculation but a wrong cache
counterfactual, omits a stronger historical rubric magnitude, and was also flagged for two historical claims not supported by the phase-scoped review packet. That evidence judgment is limited by the packet's phase scope. Its
managed run remains unfinished. Codex's initial phase timed out at six
minutes with no artifact. The changed phase has no result/completion receipt,
no artifact, and no observed remaining task process; it is incomplete, not
silently counted as another measured timeout or pass.

The alpha.27 canonical evaluator preflights also failed: Claude Code lacks
subscription authentication, and Codex's contamination canary sees unrelated
MCP apps. Existing native receipts use a different corpus and do not meet
the required 19 cells, three repetitions and two baseline comparisons.
See the [release candidate record](RELEASE-alpha.27.md) and its
[retained evidence](evidence/alpha27-release/).
