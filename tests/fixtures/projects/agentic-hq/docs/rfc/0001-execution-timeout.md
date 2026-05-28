---
title: Agent execution timeout policy
status: in-review
author: cx-platform-engineer
created: 2026-05-22
---

# RFC-0001: Agent execution timeout policy

## Summary

Agents currently have no hard execution timeout. Long-running agents can chew through provider quotas and tie up worker slots. Propose a three-tier timeout policy with explicit per-tier semantics.

## Motivation

`q1-failure-modes.md` (research) shows the long tail: 0.4% of agent runs take longer than 30 minutes; 0.02% exceed 4 hours. The 4-hour-plus cases include genuine work (large refactors via code-exec tool) and runaway loops (an agent calling `web_search` 80 times). Today there's no way to distinguish these in the running fleet.

## Proposal

Three tiers:

| Tier | Soft timeout | Hard timeout | Behavior at soft | Behavior at hard |
|---|---|---|---|---|
| `quick` | 60s | 5 min | Warn in trace | Terminate, mark `timed_out` |
| `standard` | 5 min | 30 min | Warn in trace | Terminate, mark `timed_out` |
| `long` | 30 min | 4 hours | Notify customer dashboard | Terminate, require customer ack to re-run |

Tier set per agent in YAML spec (`timeout_tier: standard` default). Existing agents without a setting get `standard`.

At soft timeout: a trace event fires (`agent.long_running`); no behavior change to the agent. Customer dashboard shows a yellow indicator. At hard timeout: agent receives a single shutdown signal; if it doesn't gracefully exit in 5s, the worker kills it.

## Open questions

- Should we expose mid-run `extend_timeout` as a tool to the agent itself? `unknown` — risk: agent extends its own runaway loop.
- Webhook on hard timeout? `[unverified]` — depends on enterprise customer ask; defer.
- How does this interact with the scratchpad work ([PRD-0001](../prd/0001-tool-calling-scratchpad.md))? Long agents are likely scratchpad users; the compression should reduce the long tail. Worth measuring the overlap.

## Rejected alternatives

- **Single hard timeout (30 min for all).** Too short for real long-running customer cases (data extraction, large refactors).
- **No timeout (status quo).** Carries fleet stability risk; one runaway agent can starve other tenants on a shared worker pool.

## Source

- `docs/research/q1-failure-modes.md` (long-tail distribution)
- ADR-0002 not directly applicable; included for context on the memory layer that long agents stress
