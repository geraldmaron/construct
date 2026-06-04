# Architecture Review: {system-or-component}

- **Date**: {YYYY-MM-DD}
- **Reviewer**: cx-architect (or named human)
- **Subject**: {existing design / proposed change / PR}
- **Related**: {ADR, RFC, PRD ids — link the design this review evaluates}
- **Verdict**: APPROVE | APPROVE_WITH_CONDITIONS | REJECT | NEEDS_REVISION
- **Status**: draft | final

<!--
An architecture review evaluates an existing or proposed design — distinct from an ADR (a
new decision record) or RFC (a proposal). Every concern cites the design property it
violates and the failure mode it enables. "I don't like it" is not a concern; "this couples
X and Y in a way that prevents Z" is.
-->

## Summary
<!-- 2–4 sentences: what was reviewed, the top-level verdict, the single most important concern. -->

## Design intent
<!-- Restate what the design is trying to achieve, in the reviewer's words. If the design's intent can't be stated clearly from the artifact, that itself is a finding. -->

## Trade-offs evaluated

| Trade-off | Option chosen | Rationale | Cost | Reversibility |
|---|---|---|---|---|
| {axis — e.g. consistency vs. availability} | {what the design picked} | {why} | {what's given up} | reversible / costly to reverse / one-way door |

## Interface contracts

| Interface | Inputs | Outputs | Error cases | Backwards compatibility |
|---|---|---|---|---|
| `{name}` | {types / shapes} | {types / shapes} | {failure modes + retry semantics} | {breaking / non-breaking + version policy} |

## Non-functional assessment

- **Scalability**: {expected load → actual capacity, with bottleneck}
- **Reliability**: {failure modes, blast radius, recovery}
- **Observability**: {what is traced, what is alerted, what isn't and why}
- **Security**: {trust boundaries, attack surface, sensitive data flow}
- **Operability**: {who runs this, how do they intervene, what's the runbook}

## Concerns

| Severity | Concern | Property violated | Failure mode enabled | Recommended change |
|---|---|---|---|---|
| critical / high / medium / low | {one-line statement} | {the design property — e.g. "single-writer per partition"} | {what breaks when this is violated} | {smallest change that restores the property} |

## Conditions for approval
<!-- If APPROVE_WITH_CONDITIONS, the conditions go here. Each condition is verifiable; the verdict flips back to NEEDS_REVISION if any condition isn't met. -->

## Rejected alternatives considered
<!-- Designs evaluated but not chosen, with the reason. An ADR-worthy review names the alternatives the original artifact didn't consider. -->

## Handoff

- changes to implement → `next:cx-engineer` or `next:cx-platform-engineer`
- ADR follow-up → `next:cx-architect` (capture the decision)
- security re-review → `next:cx-security`
