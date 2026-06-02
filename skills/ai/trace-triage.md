---
name: ai-trace-triage
description: "Use when: agent telemetry traces need triage to find where a run went wrong — the failing step, the cause category, and whether it is a regression or a one-off."
inputs: [telemetry-traces]
artifactType: trace-findings
---
# Trace Triage

Use this skill when agent telemetry traces need to be triaged to locate failures and separate systemic regressions from one-off noise.

A stable median score hides high-variance agents failing silently. Triage works the tail and the deltas, not the average.

## Steps

1. **Frame the window and baseline.** Compare the current window against a prior baseline of the same agents/skills; an absolute score means little without the delta.
2. **Sort by the tail, not the mean.** Surface the worst p10 runs and the largest score drops since baseline — that is where real failures live.
3. **For each failing run, locate the failing step**: which role/tool call produced the bad output or error. Read the span, not just the verdict.
4. **Classify the cause**: prompt/instruction gap, wrong model tier, missing context/evidence, tool error, or genuine task ambiguity. Do not default to "prompt issue".
5. **Regression vs one-off**: does the same failure recur across runs (systemic) or appear once (noise)? Only systemic failures warrant a fix; flag one-offs for watch.
6. **Hand off** systemic findings with the trace id, the failing span, the cause class, and a proposed direction (to prompt-optimizer, engineer, or evaluator).

## Output shape

```
## Window: <range> vs baseline <range>
| traceId | agent/skill | failing step | cause class | regression? | Δ score |
|---|---|---|---|---|---|

## Systemic (fix) vs one-off (watch)
```

## Verification bar

- Every finding cites a real traceId and the specific span that failed.
- Regression claims are backed by recurrence across runs, not a single bad sample.
- Cause classification is evidence-based; "unclear" is a valid class when the trace doesn't show why.
