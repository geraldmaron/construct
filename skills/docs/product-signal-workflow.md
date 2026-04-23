<!--
skills/docs/product-signal-workflow.md — Synthesize product signals from evidence.
-->
# Product Signal Workflow

Use when: the user asks what customers are asking for, what themes are emerging, whether evidence is strong enough, or what should become a PRD.

Follow [rules/common/research.md](../../rules/common/research.md) for confidence, contradictions, and source handling.

## Steps

1. Gather relevant evidence briefs, customer profiles, notes, tickets, research, and product docs.
2. Group evidence into themes, asks, pain points, affected personas, product areas, and counter-signals.
3. Assign confidence: high, medium, or low.
4. Choose the next artifact:
   - signal brief for weak or early evidence
   - evidence brief for decision-ready synthesis
   - PRD or PRFAQ for strong customer-facing product demand
   - Meta PRD for operating-system or process changes
   - backlog proposal for tracker changes after approval
5. Store synthesis in `.cx/product-intel/signals/` or `.cx/product-intel/evidence-briefs/`.

## Evidence threshold

Default threshold for PRD-ready evidence: at least two independent customers, three independent mentions, one severe enterprise blocker, or a clear strategic mandate with named risk. If the threshold is not met, write a signal brief instead of inventing requirements.

## Quality bar

Separate asks from requirements. Separate observation from inference. Name what evidence would change the recommendation.

When a claim depends on time-sensitive or external information, include the date or version basis. If evidence conflicts, state the counter-signal explicitly instead of averaging it away.
