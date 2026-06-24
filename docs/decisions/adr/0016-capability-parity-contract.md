<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0016: Capability parity across deployment surfaces is contract-governed

- **Date**: 2026-06-03
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

<!-- Owning specialist: cx-architect. Part of the Enforcement & Decision-Durability program (epic construct-wvbf). -->

## Problem

Construct runs in more than one deployment posture — an individual on a laptop, or a team sharing a database deployed on a cloud. The resource topology differs by posture: the queue is a filesystem directory in one and Postgres in another; MCP calls are direct in one and brokered in another. When those differences are implicit, two failures follow: a capability silently disappears in one posture (a user on a laptop quietly loses a feature a teammate has), or the postures diverge over time with no record of which differences are intended. Both erode the promise that Construct behaves predictably wherever it runs.

## Context

The resource topology is already declared in `lib/deployment-mode.mjs` (`RESOURCE_TOPOLOGY` over `solo`, `team`, `enterprise` across the dimensions queue, memory, database, telemetry, workers, policy, mcp). What is missing is a statement of which dimensions are expected to be at capability parity (present everywhere, backend may differ) versus intentionally mode-specific (present only in some postures), and a check that the two stay reconciled. This ADR sits inside the Enforcement & Decision-Durability program, whose governing principle is that load-bearing claims are enforced, not merely written down.

## Decision

Capability parity across deployment surfaces is governed by a machine-readable contract (`lib/deployment/parity-contract.mjs`) that classifies every topology dimension as either `parity` or `mode-specific` with a rationale, and a validator that fails when the contract and the topology drift apart. A divergence between postures is permitted only when it is declared `mode-specific`; an undeclared divergence is a defect.

## Rationale

The topology already exists as data, so the contract can be cross-checked against it mechanically rather than reviewed by eye. Classifying each dimension forces an explicit answer to "does a laptop user have this?", and the validator turns a silent regression — a new dimension added without a parity decision, or a `parity` capability that becomes absent in a mode — into a failing check. This is the same enforce-don't-assert discipline ADR-0015 affirmed, applied to deployment.

## Rejected alternatives

- **Document parity in prose only.** A markdown table of what works where would drift from the code the first time the topology changed, which is exactly the failure mode this program exists to remove. Prose is not reconciled against `RESOURCE_TOPOLOGY`; a contract is.
- **Require byte-for-byte identical backends in every mode.** Rejected as wrong: a filesystem queue on a laptop and a Postgres queue for a team are the correct designs for their postures. Parity is about the capability being present, not the backend being identical, so the contract classifies at the capability level and allows backend variation.
- **Enforce only with a live dual-run harness.** Running each capability in both solo and team and comparing output is the stronger test, but team mode needs a provisioned database, so it cannot gate every change cheaply. The static contract-vs-topology cross-check runs with no infrastructure and catches the silent-divergence case; a live harness is a complementary follow-up, not a prerequisite.

## Consequences

Adding a deployment dimension now requires declaring its parity class, or the validator fails. The contract becomes the single place that answers what a given posture can do, and reviewers can see intended divergences at a glance. The cost is one more artifact to keep current — but it is kept current by the check, not by discipline.

## Reversibility

Two-way door. The contract and validator are additive; removing them returns the system to implicit topology with no data loss. Revisit if deployment postures collapse to one, or if a live dual-run harness subsumes the static check.

## References

- ADR-0015 (affirm hybrid markdown + deterministic-enforcement architecture)
- `lib/deployment-mode.mjs` (`RESOURCE_TOPOLOGY`), `lib/deployment/parity-contract.mjs`, `tests/deployment-parity.test.mjs`
