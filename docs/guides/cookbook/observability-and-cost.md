---
title: Observability and cost
description: Trace agent runs locally or through a configured exporter, see token spend per agent, identify hotspots.
---

Construct's observability commands read from two sources:
- **Trace adapter**: local JSONL by default; Langfuse-compatible, generic HTTP, or OTLP export when configured
- **Local cost log**: file-backed token ledger read by `cost` and `efficiency` (no external dependency)

R&D-loop trace events (`intake.received`, `intake.triaged`, `task_graph.created`, `worker.started`, `worker.completed`, `evidence.recorded`, `tool.called`, `approval.requested`, …) always write to `.construct/traces/<YYYY-MM-DD>.jsonl` with no credentials. When `CONSTRUCT_TRACE_BACKEND=langfuse|http|otel` is configured, the same events are exported remotely so the intake → graph → worker → evidence chain stays correlated end-to-end. Set `CONSTRUCT_TRACE_BACKEND=none` to suppress remote export while keeping the local JSONL log.

## Review agent performance

```bash
construct review
construct review --days=7
construct review --agent=cx-engineer
```

Fetches traces from the configured trace source, computes per-agent quality scores, and writes a markdown report to
`.construct/reviews/`. The report covers quality score distribution, latency, cost, and recurring failure
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
construct optimize cx-engineer
construct optimize cx-engineer --apply
```

`--list` shows every agent with a quality score and trace count. Use it to decide which agent
to target. The bare command is a dry-run: it prints the failure diagnosis and proposed patch
without writing anything. `--apply` is the explicit gate that rewrites the agent's role skill
file (`skills/perspectives/<role>.md`) — rate-limited to one apply per agent per 7 days, with a `.bak`
backup restorable via `--rollback`.

| Flag | Effect |
|---|---|
| `--threshold=N` | Quality score below which optimization triggers (default: 0.7) |
| `--days=N` | Trace window (default: 7) |
| `--min-traces=N` | Minimum traces required before optimizing (default: 20) |

## Check token cost

```bash
construct status --json | jq .sessionUsage
```

Reads the local session usage ledger. Reports token counts, cache read and creation tokens, the latest interaction, and estimated cost. Works fully offline.

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
under `.construct/evals/`. Use these datasets for prompt regression testing or to seed a fine-tuning
corpus. Requires a remote trace backend when the local JSONL store has no scored traces.
