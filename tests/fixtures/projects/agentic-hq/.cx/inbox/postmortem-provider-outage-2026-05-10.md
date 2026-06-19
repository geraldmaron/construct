# Postmortem: Anthropic API outage cascade, May 10 2026

incident_id: inc-2026-05-10
duration: 2h 47m
impact: ~22,000 agent runs failed across all tiers; 3 enterprise customer escalations
authored_by: cx-sre
created: 2026-05-12

## Timeline (UTC)

- **2026-05-10 14:18** — Anthropic status page reports elevated error rates on `claude-3-5-sonnet`.
- **14:21** — Our retry policy kicks in (3 attempts, exponential backoff). p99 agent-run latency rises from 4s to 18s.
- **14:34** — Backoff queue depth exceeds capacity (5,000 → 12,000 in 13 min). New agent runs start rejecting at the gateway.
- **14:47** — First customer escalation: enterprise tenant `t_2c91` couldn't dispatch any agents.
- **15:02** — On-call paged. Initial hypothesis: our gateway. Verified against Anthropic status: their outage, not ours.
- **15:18** — Decision: failover to OpenAI for the `claude-3-5-sonnet` request class. Adapter exists but had not been tested in production under load.
- **15:42** — Failover deployed. 14% of agents continue to fail because their spec uses Anthropic-specific tool format that doesn't translate cleanly.
- **16:53** — Anthropic API recovers. We drain the failover. Backlog of 8,400 queued runs processes over the next 35 min.
- **17:05** — Incident closed.

## What went wrong

1. **Failover was untested.** The OpenAI adapter existed but had no production exercise. 14% of agents failed because the translation didn't cover edge cases (Anthropic tool_use blocks with no equivalent in OpenAI's format pre-2026).
2. **Backoff queue had no cap.** Queue depth grew until we couldn't process new runs. Should have a max-depth setting.
3. **No customer-facing status comms.** Enterprise customers escalated because our status page hadn't updated.

## What went right

- Detection was fast (within 3 min of Anthropic's status page update).
- Retry policy absorbed the first 13 minutes — would have been worse without it.
- No data loss; all failed runs left clean trace entries.

## Action items

1. **[open]** Failover adapter must pass a monthly exercise that simulates Anthropic outage. Owner: cx-sre.
2. **[open]** Add max-depth setting on backoff queue. Currently unbounded.
3. **[open]** Status page automation: when our error rate exceeds threshold against a single provider, post a status update.
4. **[done]** Audit the tool-format translation gaps; tracked in `bd-tool-translate-gaps`.

## What we don't know

- Whether the 14% who failed during failover were the same tenants as our biggest customers (`unknown`; correlation analysis not yet run).
