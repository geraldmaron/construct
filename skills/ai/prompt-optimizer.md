---
name: ai-prompt-optimizer
description: Closed-loop prompt optimization guide. Use when the task matches the trigger conditions described in the body.
inputs: [prompt, model-output, eval-dataset]
artifactType: prompt
---
# Prompt Optimization Loop

Construct's prompt improvement system uses telemetry traces and quality scores as the feedback signal, an LLM as the optimizer, and the role skill files (`skills/perspectives/<role>.md`, inlined into specialist prompts at sync time) as the deployment layer. This is a closed loop with a human gate: production data → failure analysis → proposed patch → **manual apply** → sync → monitoring → rollback if needed.

`construct optimize` (implemented by `scripts/optimize.mjs`) runs the whole loop. It never mutates anything without an explicit `--apply`.

## Running the optimizer

```bash
# Dry run (the default) — diagnose failures and print the proposed patch
construct optimize cx-engineer

# Apply the patch to the agent's role skill file
construct optimize cx-engineer --apply

# Restore the most recent backup
construct optimize cx-engineer --rollback

# List all agents with current quality scores
construct optimize --list

# Tune parameters
construct optimize cx-debugger --threshold=0.65 --days=14 --min-traces=5
```

Requires the telemetry backend: set `CONSTRUCT_TELEMETRY_BASEURL`, `CONSTRUCT_TELEMETRY_PUBLIC_KEY`, and `CONSTRUCT_TELEMETRY_SECRET_KEY`.

## When to run

- Triggered by `/work:optimize-prompts` (manual), the weekly `optimize-loop` scheduled job, or the session-end hook — the scheduled and hook cadences run **dry-run only** and never apply; applying is always a human act.
- Suggested when the latest performance review (`construct review`) flags an agent with an average quality score below 0.7 across at least 3 scored invocations.
- Optimization needs at least `--min-traces` low-scoring traces (default 3) to have enough signal; raise it for noisy agents.

## Step 1: Gather signal

The optimizer fetches recent traces and their quality scores for the target agent from the telemetry backend REST API:

```
GET {CONSTRUCT_TELEMETRY_BASEURL}/api/public/traces?tags={agentName}&limit=50
GET {CONSTRUCT_TELEMETRY_BASEURL}/api/public/scores?traceId={id}&name=quality
# Auth: Basic base64(CONSTRUCT_TELEMETRY_PUBLIC_KEY:CONSTRUCT_TELEMETRY_SECRET_KEY)
```

It filters to scores below the threshold (default 0.7) and extracts, per low-scoring trace: the prompt used, the user input, the model output, the quality score, and any human comments. It also reads the latest `~/.construct/performance-reviews/*-raw.json` for per-agent context.

## Step 2: Diagnose failure patterns

Low-scoring traces are analyzed as a batch for recurring failure modes. Common patterns:

| Pattern | Diagnostic signal |
|---|---|
| Output too verbose | Long outputs consistently score low; user messages are short questions |
| Missing context | Outputs lack specific file/line references; traces show no Read tool calls |
| Wrong routing | Agent performs work outside its stated role |
| Hallucination risk | Outputs assert facts not present in tool results |
| Format drift | Output format varies; scoring is inconsistent on structure |
| Insufficient depth | Outputs are correct but shallow; scored down for missing detail |

The diagnosis names the top 1–3 patterns with supporting trace counts and representative examples.

## Step 3: Generate the improved prompt

The optimizer proposes a patch that directly addresses the diagnosed failures. Rules it follows (and you should hold it to when reviewing the dry-run output):

1. **Keep what works**: compare high-scoring traces (>0.8) to low-scoring ones. Only change what's associated with failures.
2. **Surgical edits, not rewrites**: changing everything risks breaking current strengths.
3. **Be explicit, not vague**: if the failure is "too verbose", add a concrete rule ("respond in under 150 words for questions that fit on one line") not a general note ("be concise").
4. **Add a self-check instruction**: a brief checklist derived from the top failure patterns.

## Step 4: Apply (human gate)

Read the dry-run output first — always review the proposed patch before applying. Then:

```bash
construct optimize <agent> --apply
```

What `--apply` does, in order:

1. **Rate limit**: refuses if the agent was applied within the last 7 days.
2. **Patch target**: writes to the agent's role skill file `skills/perspectives/<role>.md` (e.g. `cx-engineer` → `skills/perspectives/engineer.md`). It never touches `specialists/org/**` manifests or `personas/construct.md`.
3. **Backup**: saves a `.bak` of the previous file (most recent 5 kept) — `--rollback` restores it.
4. **History**: appends the patch record to `~/.construct/prompt-history/<agent>.jsonl`.
5. **Integrity check**: verifies the patched file is structurally sane (non-empty, still a markdown document).
6. **Sync**: runs `construct sync` so the updated skill propagates to all host adapters — sync's prompt composition is the contract gate and fails loudly on a skill that does not compose.

## Step 5: Monitor and roll back

After applying, watch the agent's next scored invocations:

- `construct review` regenerates per-agent quality aggregates (`~/.construct/performance-reviews/`).
- If the agent's average score drops after the patch, restore the previous prompt:

```bash
construct optimize <agent> --rollback
```

Rollback restores the latest `.bak` and records the reversal in the same history JSONL, so the audit trail stays complete.

## What this does not replace

- **DSPy-style algorithmic optimization**: if you need optimization over large datasets with measurable metrics (classification, structured output), use a dedicated framework. This loop is for natural-language agent prompts where the metric is the quality score.
- **Human review**: the LLM optimizer can introduce subtle regressions. Applying is deliberately manual and rate-limited; automated cadences only ever propose.
