---
type: eval-finding
author: cx-evaluator
created: 2026-05-26
run_id: eval-2026-05-26-multistep
---

# Eval regression: multi-step reasoning dropped 9 points after SDK 0.4.1

## Summary

The `multi-step-reasoning` eval suite (n=247 questions, requires 3+ tool calls) regressed from 87% pass rate (run `eval-2026-05-15-multistep`) to 78% (run `eval-2026-05-26-multistep`). The intervening change was SDK release 0.4.1 on 2026-05-18.

The drop is concentrated in two question categories:
- "Plan, then execute, then verify" (28 questions): 92% → 64%
- "Compare two sources" (19 questions): 89% → 71%

Single-step questions (n=104) unchanged: 95% → 95%.

## Hypothesis

`[unverified]` — SDK 0.4.1 changed the default `temperature` from 0.0 to 0.2 in the orchestration loop. Higher temperature plausibly hurts multi-step reasoning where the chain-of-thought is brittle. Not yet tested in isolation.

## What to do next

1. Run the eval with explicit `temperature: 0.0` against current SDK to isolate the variable.
2. If temperature is the cause, revert the default or document the tradeoff and let customers set it per agent.
3. If temperature is NOT the cause, look at the next two changes in 0.4.1: scratchpad prototype shipped behind a flag (off by default) and tool-result truncation behavior changed.

## Trace evidence

Run id: `eval-2026-05-26-multistep`. Per-question results in `evals/multi-step-reasoning/results/2026-05-26.jsonl`. Sample of 15 failed questions inspected by hand — 11 of 15 had the agent take a reasonable step then "wander" on a follow-up tool call, consistent with higher temperature.

## Sources

- Eval run `eval-2026-05-26-multistep`
- Eval run `eval-2026-05-15-multistep` (baseline)
- SDK changelog 0.4.1 (in repo at `CHANGELOG.md`)
