---
title: Multi-turn tool-calling with intermediate scratchpad
status: in-progress
owner: cx-product-manager
created: 2026-04-12
intake_id: null
intake: none
intake_rationale: Authored before intake provenance was introduced; predates the tooling
---

# PRD-0001: Multi-turn tool-calling with intermediate scratchpad

## Problem

In production we see agents make 7-12 tool calls before reaching a final answer on complex tasks. Each call goes through the LLM with the full history. Two failure modes from `docs/research/q1-failure-modes.md`:

1. **Context window pressure.** Long tool histories crowd out the original task. Agents forget the goal by turn 6.
2. **No working memory.** Agents repeat tool calls because intermediate observations are interleaved with everything else.

## Goal

Give agents a structured scratchpad: a typed working-memory surface that survives across tool calls but is excluded from the final-answer context. Agents write summaries, decisions-in-progress, and partial results to the scratchpad; only the scratchpad survives compression.

## Non-goals

- Replacing the conversation context. Scratchpad augments it.
- Persistent scratchpad across agent runs (separate concern: memory layer).
- Auto-generating scratchpad content. Agents write to it explicitly.

## Approach

`Scratchpad` is a typed JSON object with three sections: `decisions[]`, `partial_results{}`, `next_actions[]`. Tools that produce structured output (search, code-exec, file-read) write summaries to `partial_results`. Agents write `decisions` and `next_actions` explicitly via a `scratchpad.append` meta-tool.

Context compression: when token usage exceeds 80% of context window, older tool calls compress to "Tool X called, summary in scratchpad.partial_results[X]". Original tool output is dropped from the LLM context but retained for audit.

## Success criteria

- Median tool-calls-to-final-answer drops by `[unverified]` — set baseline after first 30 days. Current observed: 8.4 (eval run `q1-2026-baseline`, n=247).
- No regression on simpler tasks (single-tool or no-tool tasks).
- Agents pass the `multi-step-reasoning` eval suite with 90%+ on questions requiring 5+ tool calls.

## Open questions

- Should scratchpad content count against context budget? `unknown` — leaning yes (otherwise it's free state that breaks budgeting).
- How do we surface scratchpad to users for debugging? Dashboard panel vs export log? `unknown` — needs cx-designer.

## Dependencies

- Eval framework readiness — see `docs/research/q1-failure-modes.md` baseline run.
- Memory isolation work — [PRD-0002](./0002-memory-isolation.md) — they overlap on what's "scratchpad" vs "memory".

## Sources

- `docs/research/q1-failure-modes.md` (failure-mode synthesis Q1 2026)
- ADR-0001 (tool-calling format)
- Eval baseline run id `q1-2026-baseline`
