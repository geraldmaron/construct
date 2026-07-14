---
intake: none
---

# GH #323 reconciliation — orchestration readiness / attachment diagnostics

**Bead:** `construct-72gqn.25` (D5) · **Date:** 2026-07-14 · **Verdict:** substantially delivered; re-scope, do not leave broadly open.

GH #323 ("Construct integration reliability gap: nondeterministic orchestration tool attachment and weak preflight diagnostics") predates the H9 readiness work. Reconciling its four parts (A–D), six acceptance criteria, and telemetry/test requirements against the shipped `lib/orchestration/readiness.mjs` surface shows parts A/B/C are implemented — including the exact reason-code taxonomy #323 proposed — and the residual is confined to part D and two minor items, the largest of which (`D4`) is already a tracked bead.

Every row below cites a re-verifiable source; unbuilt items are marked residual, never claimed.

## Request → implementation map

| #323 request | Status | Evidence |
|---|---|---|
| **A1** per-session capability handshake: attached/required tools, host id, session id, pass/fail verdict | delivered | `buildOrchestrationReadiness` returns `verdict`, `host`, `sessionId`, `requiredTools`, `observedTools`, `missingTools` — [readiness.mjs:232](../../../../../lib/orchestration/readiness.mjs) |
| **A2** explicit readiness state + typed reason code | delivered | `attached`/`reasonCode` — [readiness.mjs:234](../../../../../lib/orchestration/readiness.mjs) |
| **B1** one command to verify readiness for the active host session | delivered | `construct orchestrate preflight [--host] [--json]` — [bin/construct:4330](../../../../../bin/construct); `orchestration_readiness` MCP tool |
| **B2** machine- AND human-readable output | delivered | `--json` bundle vs formatted text; `orchestration_readiness` outputSchema (H9.2) |
| **B3** fail fast when required but unavailable | delivered | `verdict === 'fail'` on any non-`attached` reason — [readiness.mjs:205](../../../../../lib/orchestration/readiness.mjs) |
| **C1** failure taxonomy: `host_not_attached`, `server_unreachable`, `auth_unavailable`, `profile_mismatch`, `capability_negotiation_failed`, `version_mismatch` | delivered — exact match | `ORCHESTRATION_READINESS_REASONS` is those six verbatim, plus `attached`/`tool_unlisted`/`model_unresolved`/`execution_degraded` — [readiness.mjs:37](../../../../../lib/orchestration/readiness.mjs) |
| **C2** one deterministic next action per reason code | delivered | `NEXT_STEPS` keyed by every reason code — [readiness.mjs:56](../../../../../lib/orchestration/readiness.mjs) |
| **C3** copy-ready diagnostic bundle | delivered | `bundle` with `diagnosticId` + full env/version/tool facts — [readiness.mjs:207](../../../../../lib/orchestration/readiness.mjs) |
| **D1 / AC4** host capability parity checks run in CI, fail on regression | partial | parity suites run in the gate ([tests/parity.test.mjs](../../../../../tests/parity.test.mjs), [tests/ci-parity.test.mjs](../../../../../tests/ci-parity.test.mjs), [tests/deployment-parity.test.mjs](../../../../../tests/deployment-parity.test.mjs)) but detect by config-file existence, not runtime probe — **residual = `construct-72gqn.24` (D4)** |
| **D2 / AC3** guidance cannot drift silently from runtime capability | partial | enforced at runtime by the dispatch-guard (an `awaiting-host`/undispatched run cannot unblock solo authoring of the orchestrated deliverable — H9.1, `lib/hooks/orchestration-dispatch-guard.mjs`) and by honest tool descriptions (H9.2); no *static* check that prompt guidance references only guaranteed capabilities — **residual (minor)** |
| **D3** document known host deltas | delivered | host classes + deltas in [ADR-0063](../../../../decisions/adr/0063-host-subscription-execution-pickup-and-sampling.md); `hostExecutionViable` per scope — [readiness.mjs:206](../../../../../lib/orchestration/readiness.mjs) |
| **Telemetry 1** structured preflight events (host, session, required caps, result, reason) | delivered | `recordOrchestrationReadinessEvent` — [readiness.mjs:296](../../../../../lib/orchestration/readiness.mjs); wired into preflight at [bin/construct:4367](../../../../../bin/construct) |
| **Telemetry 3** mean-time-to-recovery from failed preflight | residual (minor) | no MTTR aggregation over readiness events |
| **AC6** startup→successful-invocation path documented + testable | partial | testable (below); no single startup→invocation runbook — **residual (minor)** |
| **Test Plan** positive / negative / cross-host | delivered | [orchestration-readiness.test.mjs](../../../../../tests/orchestration-readiness.test.mjs), [readiness-honesty.functional.test.mjs](../../../../../tests/functional/readiness-honesty.functional.test.mjs), [readiness-state-machine.test.mjs](../../../../../tests/audit/f04-host-readiness/readiness-state-machine.test.mjs), [doctor-vscode-host-readiness.functional.test.mjs](../../../../../tests/functional/doctor-vscode-host-readiness.functional.test.mjs) |

## Disposition

- **Parts A, B, C — delivered.** The core of #323 (deterministic per-session readiness, one-command preflight, and the exact typed-reason taxonomy with per-code recovery) is implemented and test-covered. #323's own reason-code list is what `readiness.mjs` ships.
- **Residual, tracked:** runtime-probe host parity is `construct-72gqn.24` (D4) — parity today reports on config-file presence, not live capability, exactly #323's D1/AC4 concern.
- **Residual, minor:** MTTR aggregation (Telemetry 3), a static guidance-vs-capability drift check (D2/AC3, already enforced at runtime), and a startup→invocation runbook (AC6) — filed as `construct-0h5r0`.

**Recommended #323 action:** re-scope — comment with this map, close the A/B/C body as delivered, and leave the residual to `construct-72gqn.24` (D4, runtime-probe parity) + `construct-0h5r0` (minor residuals). Posting the comment / closing the issue is an outward-facing GitHub action for the maintainer to take; this document is the evidence it references.
