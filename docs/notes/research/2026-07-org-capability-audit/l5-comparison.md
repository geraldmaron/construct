---
title: L5 — team-vs-solo baseline comparison
description: Whether multi-agent orchestration earns its added latency and cost against a single-agent baseline.
intake: none
---

# L5: team-vs-solo baseline comparison

Multi-agent orchestration is only worth its added latency and cost if it produces something a single agent would not. L4 proved the base chain *collaborates*; L5 measures whether that collaboration is *worth it* against a one-shot solo baseline, so the value is recorded rather than assumed.

## Method

`lib/certification/runTeamVsSoloComparison` runs the same request two ways:

1. **Team** — the base chain `architect → engineer → reviewer → qa` through the real orchestration runtime.
2. **Solo** — one generalist provider call instructed to solve the whole request on its own.

Each output is scored on a deterministic **role-concern rubric** (`ROLE_CONCERNS`): does the text actually cover architecture trade-offs, implementation, review of failure modes, and testing? The comparison records per-side coverage, output size, latency, their deltas, and a stated verdict, and writes it to the comparisons store (`.construct/certification/comparisons/<id>.json`, `capabilityId: orchestration.team`).

## Result (reproducible)

The hermetic comparison in `tests/functional/team-vs-solo-comparison.functional.test.mjs` is the recorded baseline: with each specialist contributing its own concern, the **team covers all four role concerns**; a single generalist reaches only what one pass reaches (implementation), for a coverage delta of **+3** and the verdict **`team-adds-role-concern-coverage`**. A live comparison under `CONSTRUCT_CERTIFY_LIVE=1` records the same shape against real model output, with real token and latency deltas.

## Honest scope

- Role-concern coverage is a **structural proxy** for quality — it measures whether each concern was addressed, not how well. Layering `assessArtifactQuality` (`lib/artifact-quality.mjs`) over the produced artifacts is the natural next dimension.
- The latency delta is recorded and is **real**: the chain is slower than one call. L5's claim is that the chain buys *coverage completeness* (no concern silently skipped), not speed — and that trade is only worth making when the request genuinely spans multiple concerns. A trivial request should route to the `immediate`/`focused` track, not the chain (`lib/orchestration/flow-selection.mjs`).
- This measures the *sequential* base chain. A true critic/reviser loop (work sent back for revision) is a different topology, deferred to `construct-72gqn.30` (D10).
