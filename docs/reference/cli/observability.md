---
title: Observability
description: Observability commands for Construct.
---

# Observability

| Command | What it does |
|---|---|
| `construct efficiency` | Show read efficiency, repeated files, and context-budget guidance |
| `construct eval-datasets` | Sync scored Langfuse traces into eval datasets for prompt regression testing |
| `construct evals` | Show evaluator catalog for prompt and agent experiments |
| `construct llm-judge` | Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback |
| `construct optimize` | Prompt optimization using Langfuse trace quality scores |
| `construct review` | Generate agent performance review from Langfuse trace backend |
| `construct telemetry` | Query telemetry traces and latency data |
| `construct telemetry-backfill` | Backfill sparse traces with observations (trace backend) |

## construct efficiency

Show read efficiency, repeated files, and context-budget guidance

**Usage**

```bash
construct efficiency [--json]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output raw JSON |

## construct eval-datasets

Sync scored Langfuse traces into eval datasets for prompt regression testing

**Usage**

```bash
construct eval-datasets [--limit=N]
```

**Options**

| Flag | Description |
|---|---|
| `--limit=N` | Maximum scored traces to sync (default: 100) |

## construct evals

Show evaluator catalog for prompt and agent experiments

**Usage**

```bash
construct evals [--json]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output raw JSON |

## construct llm-judge

Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback

**Usage**

```bash
construct llm-judge [--limit=N] [--model=NAME]
```

**Options**

| Flag | Description |
|---|---|
| `--limit=N` | Maximum traces to evaluate (default: 10) |
| `--model=NAME` | LLM model to use for evaluation (default: claude-3-5-sonnet-20241022) |

## construct optimize

Prompt optimization using Langfuse trace quality scores

**Usage**

```bash
construct optimize <agent> [--dry-run] [--list]
```

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Preview changes without applying |
| `--list` | Show all agents with quality scores |
| `--threshold=N` | Quality threshold to trigger optimization (default: 0.7) |
| `--days=N` | Trace window in days (default: 7) |
| `--min-traces=N` | Minimum traces required (default: 20) |

## construct review

Generate agent performance review from Langfuse trace backend

**Usage**

```bash
construct review [--days=N] [--agent=NAME] [--schedule]
```

**Options**

| Flag | Description |
|---|---|
| `--days=N` | Review window in days (default: 30) |
| `--agent=NAME` | Filter to a specific agent |
| `--out=PATH` | Output directory |
| `--json-only` | Write raw JSON only, skip markdown report |
| `--schedule` | Schedule automatic weekly reviews |
| `--cadence=CRON` | Cron expression for --schedule (default: Monday 9am) |

## construct telemetry

Query telemetry traces and latency data

**Usage**

```bash
construct telemetry query <latency|top-slow|errors|trace>
```

## construct telemetry-backfill

Backfill sparse traces with observations (trace backend)

**Usage**

```bash
construct telemetry-backfill [--limit=N]
```

**Options**

| Flag | Description |
|---|---|
| `--limit=N` | Maximum sparse traces to backfill (default: 10) |
| `--best-effort` | Skip failures instead of exiting non-zero |
