<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0019: Execution-capability is a descriptive contract, not an observation of host execution

- **Date**: 2026-06-03
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

<!-- Owning specialist: cx-architect. Part of the embedded execution-capability contract (epic construct-1txt, GH #206/#203). -->

## Problem

Embedded hosts can ask Construct to run a workflow "orchestrated," but cannot tell whether the run actually engaged personas/skills/routing or quietly degraded to a prompt-only envelope — and if it degraded, why. Each embedder reinvents its own execution-metadata model from logs. The fix is a structured execution-capability contract (GH #206), but it raises a correctness trap: in the embedded layer Construct returns an orchestration *plan* and the host runtime performs the reasoning, so Construct cannot truthfully assert that personas *ran*.

## Context

`invokeWorkflow` (`lib/embedded-contract/workflow-invoke.mjs`) computes a role chain, rationale, and applied skills, then returns them; the host executes. `resolveEmbeddedModel` (`model-resolve.mjs`) already reports a `resolutionSource` (host-model | same-family-fallback | tier-default | config-error) and refuses to claim unverifiable provider health (`healthStatus: 'unknown'`). The no-fabrication rule (`rules/common/no-fabrication.md`, in the enforced baseline) forbids load-bearing claims a reader cannot re-verify. The contract therefore must describe Construct's contribution and model-resolvability — what it planned and can run a model for — without claiming to observe host execution.

## Decision

Expose an execution-capability contract (`lib/embedded-contract/execution.mjs`, `resolveExecution`) over SDK/CLI/MCP that returns `executionMode` (construct-orchestrated | construct-prompt-only | host-direct | same-family-fallback), `constructCapabilitiesActive` (subset of personas/skills/workflow-routing/prompt-envelope), `degraded` + a machine-readable `degradationReason`, and `requestedStrategy` vs `effectiveStrategy`. The contract is **descriptive**: every response carries a mandatory `semantics` field stating that it reports planned capability and model-resolvability, not observed host execution. A `same-family-fallback` (host model unavailable) and a `config-error` (no runnable model) both map to `degraded: true`.

## Rationale

A single, versioned contract lets every host read execution truth the same way instead of parsing logs. Framing it as descriptive is the only honest option given the plan/execute split — `constructCapabilitiesActive` names what Construct contributes, and the `semantics` disclaimer makes the boundary unmissable, so the contract cannot be read as proof the host ran personas. Treating same-family-fallback as degraded is honest about not honoring the host's exact model. The resolver reuses `resolveEmbeddedModel`, so there is no second model-selection surface to drift.

## Rejected alternatives

- **Assert `personas` active because a role chain was planned.** Rejected as fabrication: Construct does not observe host execution, so claiming personas ran is a load-bearing claim the reader cannot re-verify — a direct violation of `rule:common/no-fabrication`.
- **Upgrade `healthStatus` to a claimed `healthy` once a model resolves.** Rejected: model-resolve deliberately keeps health `unknown`; the execution contract must not invent verifiable health it did not check.
- **Treat same-family-fallback as a clean `construct-orchestrated`.** Rejected: it silently hides that the host's exact model was unavailable.

## Consequences

A host can call `resolveExecution` before a workflow to render honest status, and `invokeWorkflow`/`recommendPlan` echo the planned `executionMode`. Adding the contract is additive to the Embedded Contract Layer, so `CONTRACT_VERSION` bumps minor (1.0.0 → 1.1.0) and old clients stay compatible. The `semantics` disclaimer is mandatory on every response — a test enforces its presence and that no credential value leaks.

## Reversibility

Two-way door. The contract is additive (a new resolver, additive response fields); removing it returns to the prior surfaces with no data loss. The descriptive framing is the load-bearing part — if Construct ever gains a runtime that executes orchestration in-process, a future ADR can supersede this to add observed-execution fields without breaking the descriptive ones.

## References

- `lib/embedded-contract/execution.mjs`, `lib/embedded-contract/model-resolve.mjs`, `lib/embedded-contract/contract-version.mjs`
- `tests/embedded-contract-execution.test.mjs` (binding), `tests/embedded-contract-parity.test.mjs`
- `rules/common/no-fabrication.md`
- ADR-0016 (capability parity contract)
- GH #206 (execution-capability contract), GH #203 (ingest orchestration strategy)
