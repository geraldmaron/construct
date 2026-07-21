---
name: ai-prompt-optimizer
description: Closed-loop prompt optimization guide. Use when the task matches the trigger conditions described in the body.
inputs: [prompt, model-output, eval-dataset]
artifactType: prompt
---
# Prompt Optimization Loop

Construct's prompt improvement system uses telemetry traces and quality scores as the feedback signal, an LLM as the optimizer, and Worker Profile perspective files (`skills/perspectives/<worker-profile>.md`, inlined into Worker Profile prompts at sync time) as the deployment layer. This is a closed loop with a human gate: production data → failure analysis → proposed patch → **manual apply** → sync → monitoring → rollback if needed.

`construct optimize` (implemented by `scripts/optimize.mjs`) runs the whole loop. It never mutates anything without an explicit `--apply`.

## Running the optimizer

```bash
# Dry run (the default) — diagnose failures and print the proposed patch
construct optimize engineer

# Apply the patch to the Worker Profile perspective file
construct optimize engineer --apply

# Restore the most recent backup
construct optimize engineer --rollback

# List all Worker Profiles with current quality scores
construct optimize --list

# Tune parameters
construct optimize debugger --threshold=0.65 --days=14 --min-traces=5
```

Requires the telemetry backend: set `CONSTRUCT_TELEMETRY_BASEURL`, `CONSTRUCT_TELEMETRY_PUBLIC_KEY`, and `CONSTRUCT_TELEMETRY_SECRET_KEY`.

## When to run

- Triggered by `/work:optimize-prompts` (manual), the weekly `optimize-loop` scheduled job, or the session-end hook — the scheduled and hook cadences run **dry-run only** and never apply; applying is always a human act.
- Suggested when the latest performance review (`construct review`) flags a Worker Profile with an average quality score below 0.7 across at least 3 scored invocations.
- Optimization needs at least `--min-traces` low-scoring traces (default 3) to have enough signal; raise it for noisy Worker Profiles.

## Step 1: Gather signal

The optimizer fetches recent traces and their quality scores for the target Worker Profile from the telemetry backend REST API:

```
GET {CONSTRUCT_TELEMETRY_BASEURL}/api/public/traces?tags={workerProfileId}&limit=50
GET {CONSTRUCT_TELEMETRY_BASEURL}/api/public/scores?traceId={id}&name=quality
# Auth: Basic base64(CONSTRUCT_TELEMETRY_PUBLIC_KEY:CONSTRUCT_TELEMETRY_SECRET_KEY)
```

It filters to scores below the threshold (default 0.7) and extracts, per low-scoring trace: the prompt used, the user input, the model output, the quality score, and any human comments. It also reads the latest performance review for per-Worker-Profile context.

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
construct optimize <worker-profile> --apply
```

What `--apply` does, in order:

1. **Rate limit**: refuses if the Worker Profile was applied within the last 7 days.
2. **Patch target**: writes to `skills/perspectives/<worker-profile>.md` (for example, `engineer` → `skills/perspectives/engineer.md`). It never touches `registry/**` manifests or `registry/worker-profiles/prompts/construct.md`.
3. **Backup**: saves a `.bak` of the previous file (most recent 5 kept) — `--rollback` restores it.
4. **History**: appends the patch record under the machine-state prompt history for the Worker Profile.
5. **Integrity check**: verifies the patched file is structurally sane (non-empty, still a markdown document).
6. **Sync**: runs `construct sync` so the updated skill propagates to all host adapters — sync's prompt composition is the contract gate and fails loudly on a skill that does not compose.

## Step 5: Monitor and roll back

After applying, watch the Worker Profile's next scored invocations:

- `construct review` regenerates per-Worker-Profile quality aggregates.
- If the Worker Profile's average score drops after the patch, restore the previous prompt:

```bash
construct optimize <worker-profile> --rollback
```

Rollback restores the latest `.bak` and records the reversal in the same history JSONL, so the audit trail stays complete.

## What this does not replace

- **DSPy-style algorithmic optimization**: if you need optimization over large datasets with measurable metrics (classification, structured output), use a dedicated framework. This loop is for natural-language Worker Profile prompts where the metric is the quality score.
- **Human review**: the LLM optimizer can introduce subtle regressions. Applying is deliberately manual and rate-limited; automated cadences only ever propose.
