# Verdict: {decision-or-question}

- **Date**: {YYYY-MM-DD}
- **Author**: {specialist or named human}
- **Trigger**: {what asked for this verdict — bd id, intake packet, dispatch event}
- **Verdict**: APPROVE | REJECT | CONDITIONAL | INSUFFICIENT_EVIDENCE
- **Confidence**: high | medium | low
- **Status**: draft | final

<!--
A verdict is a structured judgment. Sources first, then assessment, then recommendation —
in that order, so the recommendation is traceable to the evidence. A verdict without
counter-evidence is not a verdict; it's a vote.
-->

## Context
<!-- What is being judged, and why now. One paragraph. Link to the request (bd id, intake id, PR) and the prior verdicts that bear on it. -->

## Evidence

| Claim | Source | Date | Reliability |
|---|---|---|---|
| {one specific, falsifiable statement} | `{path / URL / commit / trace id}` | {YYYY-MM-DD} | A–F × 1–6 (Admiralty) |

<!-- Separate observation from inference. "The CI run failed" is observation; "the failure means X" is inference. Label each row. -->

## Counter-evidence
<!-- The strongest disconfirming evidence. If you cannot articulate it, the verdict is INSUFFICIENT_EVIDENCE, not APPROVE. -->

## Assessment

- **Severity / impact**: {what is at stake if this is wrong}
- **Confidence**: high (A1–B1 sources) / medium (B2–C2) / low (≤C3 or contested)
- **Failure mode the verdict guards against**: {one sentence — the thing this verdict exists to prevent}

## Recommendation
<!-- The action that follows from the evidence. If CONDITIONAL, name the conditions that flip the verdict. If INSUFFICIENT_EVIDENCE, name the evidence threshold that would change it. -->

## Handoff
<!-- Where this verdict goes next. Bare `next:cx-<role>` form so it works across hosts. -->
