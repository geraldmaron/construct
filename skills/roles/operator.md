---
name: roles-operator
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Operator role. Use when reviewing or generating work by cx-sre, cx-operations, cx-release-manager, cx-docs-keeper, or when an agent is acting in the Operator role.
inputs: [runbook, deployment-plan]
artifactType: role-guidance
role: operator
applies_to:
  - cx-sre
  - cx-operations
  - cx-release-manager
  - cx-docs-keeper
inherits: null
version: 2
profiles:
  - rnd
cap: 1
---
# Operator. Role guidance

Load this before producing operator output. SRE, ops, release, and durable-knowledge work.


### 1. Runbook by incantation
**Symptom**: the runbook tells the on-call what to type but not what the commands do or what their output means.
**Why it fails**: when the commands fail or return unexpected output, the on-call has no foundation for improvising.
**Counter-move**: each step names its purpose, its expected output, and what "wrong" looks like.

### 2. Rollback as afterthought
**Symptom**: the deployment plan describes the forward path in detail but rollback in one line: "revert if needed".
**Why it fails**: rollback is attempted at 3am under pressure. Untested rollback paths fail or make things worse.
**Counter-move**: rollback is a first-class plan. Tested. With criteria for when to trigger it.

### 3. Alert noise
**Symptom**: the on-call receives dozens of alerts per shift; most are ignored.
**Why it fails**: real alerts drown in noise. On-call health erodes. Teams learn to ignore paging.
**Counter-move**: every alert is actionable or it should not page. Move non-actionable signals to dashboards. Review alert rate every month.

### 4. No observability before launch
**Symptom**: a service ships without dashboards, logs, or traces wired in; observability is added after the first incident.
**Why it fails**: the first incident is solved in the dark. Recovery takes far longer than it needed to.
**Counter-move**: no service launches without its SLO, its dashboard, and its three golden signals instrumented.

### 5. Post-incident blame
**Symptom**: the incident report names individuals and their mistakes; corrective actions are "be more careful".
**Why it fails**: nobody learns. Mistakes recur. Reporting culture degrades.
**Counter-move**: blameless tone. Corrective actions target the system, not the person. "Be more careful" is not a control.

### 6. Documentation drift
**Symptom**: runbooks, architecture docs, and decision records last updated two years ago.
**Why it fails**: new on-calls follow stale instructions; decisions get re-debated because the rationale was lost.
**Counter-move**: every operational doc has a "last tested" or "last reviewed" date. Stale docs are flagged, not silently trusted.

### 7. Silent release
**Symptom**: a change ships without a changelog, comms, or stakeholder awareness.
**Why it fails**: users are surprised. Support is unprepared. Incidents take longer because responders do not know what changed.
**Counter-move**: every non-trivial release has a changelog entry, a rollback plan, and a comms channel notified.

### 8. Unbounded retries

**Symptom**: failures retried forever or with naive backoff; retries hide underlying capacity issues.

**Why it fails**: retry storms amplify outages. A transient failure becomes a full incident.

**Counter-move**: bounded retries. Exponential backoff with jitter. Circuit breakers on downstream dependencies.

### 9. Execution gap blindness

**Symptom**: strategy/PRDs/RFCs document what should be built, but Jira tickets don't reflect the full scope. Work drifts without detection.

**Why it fails**: no systematic comparison between planned work (documents) and actual work (tickets). Gaps accumulate silently until delivery dates slip.

**Counter-move**: run periodic gap analysis: query strategy/PRDs/RFCs from knowledge base, compare with Jira tickets via search, identify missing tickets. Create gap-filling tickets automatically (or queue for approval). Treat "execution gap" as a first-class risk signal.

## Methodology

Sequencing work is a calculation, not a vibe:

- **Critical path.** Build the dependency graph of the work, then find the longest chain of dependent tasks — that chain, not the total task count, sets the earliest finish. Shortening anything off the critical path does not move the date; shortening the critical path does. Re-find it after every scope change, because it moves.
- **Slack.** Tasks off the critical path have slack (they can slip without moving the date). Spend attention proportional to slack: a one-day slip on a zero-slack task is a schedule slip; the same slip with five days of slack is noise.
- **Resource leveling.** Two critical tasks needing the same owner cannot truly run in parallel — leveling for the real constraint (people, environments, review capacity) usually extends the path the naive graph hid. Sequence to the actual bottleneck.

## Self-check before shipping

- [ ] Critical path identified; the date is driven by it, not by task count
- [ ] Each runbook step names its purpose and expected output
- [ ] Rollback is a tested, first-class plan with trigger criteria
- [ ] Every alert is actionable; non-actionable signals moved to dashboards
- [ ] SLO, dashboard, and golden signals in place before launch
- [ ] Incident reports are blameless; corrective actions target the system
- [ ] Operational docs have a last-tested or last-reviewed date
- [ ] Every release has a changelog, rollback, and comms plan
- [ ] Retries are bounded; circuit breakers protect dependencies
- [ ] Execution gaps between strategy/PRDs/RFCs and Jira tickets are detected and closed
