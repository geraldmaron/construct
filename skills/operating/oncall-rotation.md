---
name: operating-oncall-rotation
description: Use when setting up on-call, reviewing its health, or handling an escalation during a rotation.
---
# On-Call Rotation

Use when setting up on-call, reviewing its health, or handling an escalation during a rotation.

## Rotation design

**Coverage model options:**

- **Follow-the-sun**: different engineers cover different time zones. Requires team distribution across 3+ time zones to avoid coverage gaps. Reduces overnight pages.
- **Single-shift**: one engineer covers a full week. Simpler coordination. Works for small teams where follow-the-sun isn't viable. Requires enforced recovery time after high-incident weeks.
- **Paired on-call**: primary + secondary. Secondary only engages if primary doesn't acknowledge within N minutes. Reduces burnout from false alarms; adds coordination cost.

**Rotation length:**
- 1 week per rotation is the industry standard for teams with reasonable incident rates.
- Longer rotations (2 weeks) reduce context-switching but increase risk of burnout during high-incident periods.
- Short rotations (<1 week) reduce individual exposure but increase handoff overhead.

**On-call health indicators:**
- Average pages per shift: >5 actionable pages/week is a process smell; >10 is a reliability emergency.
- False alarm rate: >30% of pages should not have paged are training the team to ignore alerts.
- After-hours page frequency: tracking this over time is how you build the case for reliability investment.

## Runbook quality bar

A runbook that takes more than 5 minutes to find the right section has failed its design goal. A runbook that can't be followed by a new engineer at 2am has also failed.

**Required sections for every runbook:**
1. **Alert description**: what fired, what it measures, what threshold triggered it.
2. **Impact assessment**: how to determine customer impact (which metrics to check, which queries to run).
3. **Triage steps**: concrete commands or links in priority order. Not explanations; steps.
4. **Escalation path**: who to page next if triage doesn't resolve within 30 minutes. Named people with contact method.
5. **Common resolutions**: the 3-5 fixes that cover 80% of this alert's pages. Link to rollback procedure.
6. **Related alerts**: alerts that fire together with this one; the combination often indicates the root cause faster.

**Runbook review cadence:** every runbook should be reviewed and verified after each page that required it. Stale runbooks are worse than no runbooks because they create false confidence.

## Handoff protocol

**At shift end:**
- Document any open or ongoing issues with current status.
- Note any alerts that fired but were suppressed or ignored (and why).
- Flag any systems in degraded state that might page in the next shift.
- Confirm the incoming engineer acknowledges the handoff, async is not a handoff.

**Handoff template:**
```
Shift: [start] → [end]
Pages: [count] actionable, [count] false alarms
Open issues:
  - [issue]: current status, expected resolution, owner
Watch items (might page):
  - [system]: reason for concern, what to check if it fires
Suppressed alerts:
  - [alert]: reason suppressed, when to re-enable
```

## Escalation chain

**Design principles:**
- Every engineer on-call must know the full escalation chain before they go on.
- Escalation should never require asking who to escalate to during an incident.
- The escalation chain should be in the runbook, in the incident channel topic, and in the rotation documentation.

**When to escalate immediately (don't wait):**
- SEV-1 in production with no clear path to resolution within 30 minutes
- Data loss or risk of data loss
- Security incident or suspected breach
- Financial impact beyond a defined threshold

**Escalation anti-patterns:**
- Escalating silently (notify the escalation path that you're escalating and why)
- Escalating and then detaching (you're still on the call unless explicitly relieved)
- Failing to escalate because "I don't want to wake them up", that's what the on-call contract is for

## On-call health and sustainability

On-call is a tax on engineering velocity. Track it explicitly.

**Metrics to report monthly:**
- Total pages per engineer per shift
- After-hours page rate
- Pages that required human action vs. self-resolved
- Runbook coverage rate (pages that had a runbook vs. those that didn't)

**Sustainability signals:**
- Engineers expressing reluctance to be on-call is a signal, not a discipline issue.
- High turnover on teams with heavy on-call burden is a reliability cost, not a people cost.
- If on-call requires more than 10 hours/week of active response on average, the system is broken.
