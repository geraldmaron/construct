<!--
skills/ai/prompt-optimizer.md — Closed-loop prompt auto-optimization guide.

Uses Langfuse traces and quality scores as the feedback signal, Claude as the optimizer,
and the agent registry + construct sync as the deployment layer.
-->
# Prompt Auto-Optimization Loop

Construct's prompt improvement system uses Langfuse traces and quality scores as the feedback signal, Claude as the optimizer, and the agent registry (`agents/registry.json`) as the deployment layer. This is a closed loop: production data → failure analysis → improved prompt → staging → promotion.

## Running the optimizer

```bash
# Analyze and push staging version
construct optimize cx-engineer

# Dry run — see failure patterns without pushing
construct optimize cx-engineer --dry-run

# List all agents with current quality scores
construct optimize --list

# Tune parameters
construct optimize cx-debugger --threshold=0.65 --days=14 --min-traces=15
```

The optimizer requires Python 3.12+ (`pip3` must be available). It will auto-install `dspy-ai` and `requests` on first run. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`. DSPy uses the same LLM key Construct uses — no separate setup.

## When to run

- Triggered by `/work:optimize-prompts` (manual) or the scheduled task `prompt-optimization-weekly`
- Automatically suggested when `cx-trace-reviewer` finds an agent with median quality score below 0.65 over the past 7 days
- Never run optimization on prompts with fewer than 20 scored traces — insufficient signal

## Step 1 — Gather signal

Retrieve the current production prompt for the target agent from `agents/registry.json` (or the corresponding `promptFile` if using extracted prompts).

Then retrieve recent traces via the Langfuse REST API:

```
GET {LANGFUSE_BASEURL}/api/public/traces?tags={agentName}&limit=50
# Auth: Basic base64(LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY)
```

To fetch quality scores for traces:
```
GET {LANGFUSE_BASEURL}/api/public/scores?traceId={id}&name=quality
```

Filter to scores where `value < 0.7`. For each low-scoring trace, extract: the prompt used, the user input, the model output, the quality score, and any human comments.

## Step 2 — Diagnose failure patterns

Analyze the low-scoring traces as a batch. Identify recurring failure modes. Common patterns:

| Pattern | Diagnostic signal |
|---|---|
| Output too verbose | Long outputs consistently score low; user messages are short questions |
| Missing context | Outputs lack specific file/line references; traces show no Read tool calls |
| Wrong routing | Agent performs work outside its stated role |
| Hallucination risk | Outputs assert facts not present in tool results |
| Format drift | Output format varies; scoring is inconsistent on structure |
| Insufficient depth | Outputs are correct but shallow; scored down for missing detail |

Write a failure summary: top 3 patterns with supporting trace count and representative examples.

## Step 3 — Generate improved prompt

Write an improved prompt that directly addresses the diagnosed failures. Rules:

1. **Keep what works** — compare high-scoring traces (>0.8) to low-scoring ones. Only change what's associated with failures.
2. **Surgical edits, not rewrites** — changing everything risks breaking current strengths. Identify the specific clauses that correlate with failures.
3. **Be explicit, not vague** — if the failure is "too verbose", add a concrete rule ("respond in under 150 words for questions that fit on one line") not a general note ("be concise").
4. **Add a self-check instruction** — append a brief checklist the agent runs before responding, derived from the top failure patterns.

## Step 4 — Push to staging

Update the agent's prompt in `agents/registry.json` (or the corresponding `promptFile`) with a staging marker comment. Tag the version by writing to `.cx/decisions/prompt-staging-{agent}-{date}.md`.

Log the candidate prompt as a span attribute on a test run batch using `cx_trace`. Tag spans with `promptVersion: staging-{timestamp}` and score them with `cx_score` as traces complete.

Do not overwrite the production prompt in the registry until promotion is confirmed.

## Step 5 — Monitor staging

After at least 20 scored traces on the staging version:
- Compare median quality score: staging vs production
- If staging median > production median + 0.05: promote
- If staging median ≤ production median: rollback (restore previous prompt, document why)

To promote: update the agent registry with the accepted prompt and run `construct sync`.

## Step 6 — Document the optimization

Write to `.cx/decisions/` with:
- Which agent was optimized
- Previous vs new median quality score
- Top 3 failure patterns addressed
- What changed in the prompt (diff summary)
- Date and version numbers

This becomes the audit trail for future optimizations and regression analysis.

## Regression detection

Run `cx-trace-reviewer` after every promotion. If the newly promoted prompt shows worse performance after 48 hours of production traffic:
1. Revert to the previous prompt in the registry and run `construct sync`
2. Start a new optimization cycle with the regression as the primary failure signal

## What this does not replace

- **DSPy**: If you need algorithmic optimization over large datasets with measurable metrics (classification, structured output), DSPy is the right tool and integrates with Langfuse for tracing. This skill is for natural-language agent prompts where the metric is quality score.
- **Human review**: Always read the generated prompt before pushing to staging. The LLM optimizer can introduce subtle regressions. Automated promotion should only happen after confirming the diff makes sense.
