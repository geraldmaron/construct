---
type: trace-anomaly
detected_by: cx-trace-reviewer
created: 2026-05-26
trace_window: 2026-05-25T00:00Z to 2026-05-26T00:00Z
---

# Memory recall p99 spiking on the `team-prod` shard

## What I observed

The `memory.recall` operation on the `team-prod` Postgres shard shows p99 latency rising over the last 5 days:
- 2026-05-22: p99 = 87ms (within SLO target of 100ms)
- 2026-05-26: p99 = 312ms (3.6x baseline)

Median is stable (38ms → 41ms). The mean is up ~22%. The shape of the distribution shifted: a new mode appeared above 250ms that wasn't there before.

## Trace evidence

Sampled 20 traces above 250ms from 2026-05-26. All 20 share:
- Tenant from the same enterprise customer (`t_2c91`).
- Query embeddings dimension 1024 (Cohere v3, expected).
- IO time accounts for 80% of the span (network to Postgres slow, not query plan).

Same customer's traces from 2026-05-22 don't show the slow mode.

## Hypothesis

`[unverified]` — the customer onboarded a new high-volume integration on 2026-05-23 (correlation, not causation yet). Possible their new traffic pattern is hitting a hot partition in the shard, or their workload is hitting a connection-pool limit.

## What to do next

1. cx-sre: confirm connection pool saturation hypothesis (check `pg_stat_activity` time series).
2. If saturated, decide: raise pool limit (short-term) or move the customer to a dedicated shard (long-term, fits PRD-0002 work).
3. Customer notification: not yet warranted; latency is still within their contractual SLA, just trending toward it.

## What I can't tell from traces alone

- Whether the customer experiences this as a problem yet (their app latency budget includes our latency plus their own; they may have headroom).
- Whether the new mode is one customer's entire fleet or just one of their agents.
