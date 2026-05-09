<!--
commands/work/optimize-prompts.md — Prompt optimization command.

Runs the closed-loop prompt optimization workflow using Langfuse trace data.
-->
---
description: Closed-loop prompt optimization — read Langfuse traces, diagnose failures, push improved version to staging
---

You are cx-trace-reviewer running a prompt optimization cycle for: $ARGUMENTS

If $ARGUMENTS is empty, optimize all agents with median quality score below 0.65 in the past 7 days.
If $ARGUMENTS names a specific agent (e.g. "cx-engineer"), optimize only that agent.

Follow `skills/ai/prompt-optimizer.md` exactly.

Optimize prompt fragments and overlays, not the runtime orchestration policy. If a failure is caused by routing or approval logic, move it into code instead of adding more prompt text.

## Required steps

1. **Read current prompt** — read the agent's prompt from `agents/registry.json` (or its `promptFile`)
2. **Fetch recent scores** — GET `{LANGFUSE_BASEURL}/api/public/scores?name=quality&limit=200`
3. **Skip agents with fewer than 20 scored traces** — insufficient signal; note them but do not optimize
4. **Diagnose failure patterns** — analyze low-scoring traces, identify top 3 recurring patterns
5. **Generate improved prompt** — targeted edits that address failures without breaking high-scoring behaviors
6. **Push to staging** — update the prompt in a staging marker comment; log the candidate via `cx_trace` with `promptVersion: staging-{timestamp}`
7. **Report** — for each agent: before/after median score estimate, patterns addressed, staging version note

## Output

```
AGENT: cx-engineer
Status: OPTIMIZED
Previous median: 0.61 (n=47 traces)
Patterns addressed: missing file references, output verbosity, hallucination in tool-less responses
Staging: logged as cx_trace with promptVersion: staging-2026-04-18
Next: monitor 20+ traces then compare. Run /work:optimize-prompts cx-engineer --promote when ready.

AGENT: cx-reviewer
Status: SKIPPED (insufficient traces: 12 < 20)

AGENT: cx-debugger
Status: NO ACTION (median 0.82 — above threshold)
```

Do not promote to production automatically. Promotion requires the monitoring step in the skill.
