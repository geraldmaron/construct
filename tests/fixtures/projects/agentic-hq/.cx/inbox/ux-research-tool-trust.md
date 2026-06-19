---
type: ux-research-note
author: cx-ux-researcher
created: 2026-05-23
sessions: 5
---

# Customers can't tell why their agent chose tool X over tool Y

5 interviews this week with team-tier customers, all developers, all building production agents for the last 60+ days. The recurring theme: lack of visibility into the agent's tool-selection reasoning.

Verbatim sample (anonymized to tenant id):

> "It chose web_search when I expected it to use our internal docs tool. I have no idea why. The trace shows the call happened but not the decision." — tenant `t_5a23`

> "When the agent makes a wrong tool call I just rerun and hope. There's no way to ask why." — tenant `t_8f12`

> "I'd pay for an explainability dashboard. Right now I'm guessing." — tenant `t_2c91` (also escalated the May 10 outage)

## What I observed

- All 5 customers had a workflow where wrong tool selection wasted minutes (rerun + waiting).
- 3 of 5 explicitly mentioned they would describe the agent as "a black box" if asked.
- 2 customers had built their own monkey-patch logging around our SDK to capture more detail — implies clear demand.

## What I think the underlying problem is

We log the WHAT (tool called, args, result) but not the WHY (which other tools were considered, what made this one preferred). The LLM has the reasoning internally; we don't surface it.

This is `[inferred]`, not confirmed. A controlled study with 12+ customers would let us quantify.

## Recommended follow-ups

- cx-product-manager: scope a "tool reasoning trace" feature. Surface the LLM's tool-selection rationale per call.
- cx-designer: mock a tool-trace panel for the customer dashboard.
- cx-ux-researcher: expand the interview to 12+ customers to validate the inferred underlying problem.

## Sources

- Interview transcripts stored at `[unverified]` — recorded by cx-ux-researcher; not yet checked into the knowledge store.
- Earlier signal: customer-loop-complaint.eml (different problem, but same theme: visibility into agent decisions).
