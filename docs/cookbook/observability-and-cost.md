---
title: Observability and cost
description: Trace agent runs in the telemetry backend, see token spend per agent, identify hotspots.
---

<!--
docs/how-to/how-to-observability.md — How to use Construct's observability commands.

Covers construct review, construct optimize, construct cost, construct efficiency,
and construct eval-datasets. Requires a telemetry backend for review/optimize/eval-datasets.
-->

# How to Use Observability Commands

Construct's observability commands read from two sources:
- **Telemetry backend** — trace backend for `review`, `optimize`, and `eval-datasets` (requires `CONSTRUCT_TELEMETRY_PUBLIC_KEY` and `CONSTRUCT_TELEMETRY_SECRET_KEY`)
- **Local cost log** — file-backed token ledger read by `cost` and `efficiency` (no external dependency)

R&D-loop trace events (`intake.received`, `intake.triaged`, `task_graph.created`, `worker.started`, `worker.completed`, `evidence.recorded`, `tool.called`, `approval.requested`, …) are written to two places concurrently: `.cx/traces/<YYYY-MM-DD>.jsonl` (always on, no credentials required) and the telemetry backend (when the keys above are configured). Each `traceId` appears in the telemetry backend as a single trace with one observation per emitted event so the intake → graph → worker → evidence chain stays correlated end-to-end. Set `CONSTRUCT_TRACE_BACKEND=none` to suppress the telemetry export while keeping the local JSONL log.

## Review agent performance

```bash
construct review
construct review --days=7
construct review --agent=cx-engineer
```

Fetches traces from the telemetry backend, computes per-agent quality scores, and writes a markdown report to
`.cx/reviews/`. The report covers quality score distribution, latency, cost, and recurring failure
patterns.

| Flag | Effect |
|---|---|
| `--days=N` | Review window (default: 30) |
| `--agent=NAME` | Filter to one agent |
| `--out=PATH` | Override output directory |
| `--json-only` | Write raw JSON only |
| `--schedule` | Schedule automatic weekly reviews |

## Optimize a prompt

```bash
construct optimize --list
construct optimize cx-engineer --dry-run
construct optimize cx-engineer
```

`--list` shows every agent with a quality score and trace count. Use it to decide which agent
to target. `--dry-run` previews changes without applying. Without `--dry-run`, it rewrites the
agent's system prompt slice in `registry.json`.

| Flag | Effect |
|---|---|
| `--threshold=N` | Quality score below which optimization triggers (default: 0.7) |
| `--days=N` | Trace window (default: 7) |
| `--min-traces=N` | Minimum traces required before optimizing (default: 20) |

## Check token cost

```bash
construct cost
construct cost --days=7
construct cost --agent=construct
```

Reads the local cost log. Reports total interactions, provider token breakdown (in/out/reasoning),
cache read rate, and estimated cost. Works fully offline.

| Flag | Effect |
|---|---|
| `--days=N` | Limit to last N days |
| `--agent=NAME` | Filter to one agent |
| `--reset` | Clear the cost log |
| `--json` | Raw JSON output |

## Check context efficiency

```bash
construct efficiency
```

Reports read efficiency for the current session: total reads, unique files, repeated read rate,
large reads, and bytes consumed. Surfaces the top repeated files so you can distill or compact
before they inflate context further.

Run this when a session feels slow or when you want to check if context budget is being wasted.

## Sync eval datasets

```bash
construct eval-datasets
construct eval-datasets --limit=50
```

Pulls scored telemetry traces (those with a `quality` score) and writes them as eval datasets
under `.cx/evals/`. Use these datasets for prompt regression testing or to seed a fine-tuning
corpus. Requires telemetry backend credentials.
