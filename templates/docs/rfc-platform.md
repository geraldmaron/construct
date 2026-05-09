# Platform RFC: {title}

- **Date**: {YYYY-MM-DD}
- **Author**: {name}
- **Status**: draft | in-review | accepted | rejected | superseded
- **Change type**: breaking | non-breaking | additive
- **Affects**: {API | SDK | schema | event | config | permission model | protocol}
- **Supersedes**: {RFC title or N/A}

<!--
Use this when the proposal changes a contract consumed by other systems:
APIs, SDKs, schemas, event payloads, permission models, config shapes, or protocols.

Use rfc.md instead for proposals that do not touch external contracts.
-->

## Summary
<!-- One paragraph. What contract is changing, in what direction, and why. -->

## Motivation
<!-- What problem or limitation in the current contract drives this change? Cite evidence: consumer pain points, incidents, performance data, support load. Explain why the current interface cannot simply be extended. -->

## Breaking change declaration
<!-- Be explicit: what is breaking, what is not. List every removed, renamed, or semantically changed interface element. Omitting a breaking change here is a contract violation. -->

## Proposed contract
<!-- The new interface in full. Schemas, endpoint signatures, payload shapes, permission rules, config fields. Be precise enough that a consumer can write against this spec without asking questions. -->

## Backwards compatibility strategy
<!-- How existing consumers are supported during transition. Options: versioning, dual-write, feature flags, shim layer, deprecation window. State which and why. -->

## Migration guide
<!-- Step-by-step: what a consumer must change, in what order, with examples. If migration tooling is provided, describe it. If migration is manual, estimate effort. -->

## Versioning and deprecation
<!-- Version scheme for this interface. Deprecation timeline for the old version: announcement date, sunset date, removal date. Include who owns communicating the deprecation to consumers. -->

## Consumer impact analysis
<!-- List known consumers. For each: what breaks, what changes, what stays compatible, estimated migration effort. Flag consumers that require coordinated migration. -->

## Rollout plan
<!-- How the new contract ships alongside the old one. Dual-version period, traffic migration, kill switch, removal gate. Include the observable signal that triggers each phase. -->

## Operational requirements
<!-- Observability, rate limits, error handling, fallback behavior, and admin controls required for the new contract to be supportable. -->

## Tradeoffs and alternatives
<!-- Other contract designs considered. For each: what it is, why it was not chosen. -->

## Risks
<!-- Compatibility gaps, consumer adoption risk, timing risk, coordination failure. For each: likelihood, impact, mitigation. -->

## Verification
<!-- How we confirm the migration succeeded and the old version can be safely removed. Metrics, tests, observable evidence. -->

## Unresolved questions
<!-- Genuine unknowns. Each names an owner and a decision deadline. -->

## References
<!-- Related ADRs, prior RFCs, API design guidelines, consumer runbooks, tickets. -->
