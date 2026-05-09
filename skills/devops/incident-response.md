<!--
skills/devops/incident-response.md — Incident Response — | Sev | User impact | Response time | Example |

## Severity Levels | Sev | User impact | Response time | Example |
-->
# Incident Response

## Severity Levels

| Sev | User impact | Response time | Example |
|---|---|---|---|
| **P0** | Total outage, data loss, security breach | Immediate (< 5 min) | Production DB down, credentials leaked |
| **P1** | Major feature broken for all users | < 15 min | Auth service down, checkout failing |
| **P2** | Significant degradation, partial outage | < 1 hour | Elevated error rate, slow responses |
| **P3** | Minor impact, workaround available | Best effort / next business day | Single user affected, cosmetic |

Define severity in your runbook and assign it early — it determines escalation and comms cadence.

## The Response Loop

```
Detect → Declare → Triage → Mitigate → Resolve → Post-mortem
```

### Detect

Alert sources: Prometheus/Grafana alerting, Datadog, PagerDuty, user reports, on-call rotation.

Healthy detection requires:
- Symptom-based alerts (error rate, latency p99, availability) not just cause-based
- Alert fatigue prevention: alert on SLO burn rate, not raw thresholds
- Clear escalation paths: who gets paged first, who is backup

### Declare

Declare an incident early, even if uncertain. It is easier to downgrade than to delay comms.

1. Create incident channel: `#incident-YYYY-MM-DD-brief-description`
2. Assign **Incident Commander (IC)** — one person owns the call and all decisions
3. Assign **Scribe** — records timeline, decisions, actions in real time
4. Assign **Comms Lead** — status page updates and stakeholder notifications

### Triage

IC asks: **"What is the user impact and is it getting better or worse?"**

```
1. Confirm the alert is real (not a monitoring fluke)
2. Bound the blast radius — how many users? Which regions?
3. Identify the change vector — what deployed recently?
4. Establish a working hypothesis
```

Use `git log --since="2 hours ago"` and deployment logs to find the change vector.

### Mitigate (not root cause — stop the bleeding first)

Mitigation options in priority order:
1. **Rollback** — fastest if a recent deploy is the cause
2. **Feature flag off** — disable the failing feature
3. **Traffic shift** — route to a healthy region or canary
4. **Scale up** — if resource exhaustion is the cause
5. **Restart** — for stuck processes (last resort — often hides root cause)

Do NOT wait for a perfect fix. Mitigate first, fix properly after users are unblocked.

### Resolve

Incident is resolved when:
- User impact returns to baseline
- Monitoring shows healthy signals for ≥ 15 minutes
- A clear path to permanent fix is identified

Close the incident channel. Update the status page. Send resolution notification to stakeholders.

## Communication During the Incident

### Status page cadence

| Phase | Cadence |
|---|---|
| P0/P1 active | Every 15 minutes |
| P2 active | Every 30–60 minutes |
| Resolved | One final update with summary |

Status updates must include: what is impacted, what we know, what we are doing, when the next update is.

```
[INVESTIGATING] We are seeing elevated error rates on the checkout service.
Impact: ~30% of checkout attempts are failing.
We are investigating and will provide an update in 15 minutes.
```

### Internal Slack cadence

IC posts to the incident channel:
- Current hypothesis
- Actions being taken and by whom
- Decisions made
- New findings

Scribe captures everything in the timeline doc.

## Post-Mortem (Blameless)

Write the post-mortem within 48 hours while memory is fresh.

### Required sections

1. **Summary** — 3-sentence description of what happened, impact, and resolution
2. **Timeline** — chronological log with timestamps
3. **Root cause(s)** — use 5-whys to reach systemic causes, not surface symptoms
4. **Contributing factors** — process/tooling gaps that allowed the issue
5. **What went well** — detection worked, rollback was fast, etc.
6. **Action items** — concrete, assigned, time-bounded; not vague recommendations

### 5-Whys example

```
User impact: checkout error rate 30%
Why? → Payment service returning 500s
Why? → DB connection pool exhausted
Why? → Query added in yesterday's deploy was unindexed and slow
Why? → No query performance review in the PR process
Why? → We have no policy requiring EXPLAIN ANALYZE on new queries

Action: Add query plan check to PR template + CI gate for slow queries
```

### Blameless culture

The post-mortem finds systemic failures, not individual errors. A person took an action that made sense given the information and tools available at the time — the question is why the system allowed that action to cause an outage.

## Runbook Template

Every on-call service should have a runbook per alert type:

```markdown
# Alert: HighPaymentErrorRate

## What this means
The fraction of payment attempts returning 5xx has exceeded 5% for 5 minutes.

## Immediate checks
1. `kubectl logs -n payments -l app=payment-svc --tail=100`
2. Check Grafana → Payments dashboard → DB connection pool utilization
3. Check recent deploys: `kubectl rollout history deployment/payment-svc`

## Mitigation options
- If deploy-related: `kubectl rollout undo deployment/payment-svc`
- If DB-related: page DBA on-call; check slow query log

## Escalation
If unresolved after 20 min: escalate to on-call lead.
```

## Tools Reference

| Need | Tool |
|---|---|
| Alerting | PagerDuty, OpsGenie |
| Dashboards | Grafana, Datadog |
| Log search | Loki, Datadog Logs, CloudWatch |
| Trace analysis | Jaeger, Tempo, Datadog APM |
| Status page | Statuspage.io, Atlassian Status |
| Incident management | Incident.io, FireHydrant, PagerDuty IR |
| Post-mortem tracking | Linear, Jira, Notion |
