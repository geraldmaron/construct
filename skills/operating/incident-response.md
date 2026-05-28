<!--
skills/operating/incident-response.md (Incident Response)
Use when a production issue is active, when drafting incident process,
or when running a postmortem. Covers severity tiers, war-room roles,
communication cadence, blameless postmortem structure, and MTTR
discipline.
-->

# Incident Response

Use when an issue is active in production, when building incident process from scratch, or when reviewing postmortems for quality.

## Severity tiers

Define tiers in terms of customer impact, not system state. A database at 80% CPU is not an incident; a checkout flow returning 500s is.

| Tier | Customer impact | Response time | Escalation |
|---|---|---|---|
| SEV-1 | Complete outage or data loss for any customers | Immediate; all-hands | CEO, CTO, on-call lead in 15 min |
| SEV-2 | Significant degradation affecting >10% of users or a critical path | Within 15 min | On-call lead, product lead |
| SEV-3 | Partial degradation, workaround exists | Within 1 hour | On-call engineer |
| SEV-4 | Minor issue, no customer impact yet | Next business day | Backlog |

Sev assignment belongs to the incident commander, not the engineer who discovered it.

## War-room roles

Assign these before the call gets noisy:

- **Incident commander (IC)**: owns the decision tree. Delegates; does not debug. Calls the all-clear. One person only.
- **Technical lead**: owns diagnosis and remediation. Reports status to IC every 10 minutes.
- **Comms lead**: owns customer-facing status page updates and internal stakeholder messages. Never blocks on perfect information.
- **Scribe**: documents timeline, decisions, and action items in real time. Even partial notes are better than none.

Rule: if someone doesn't have a role, they should be a silent observer or leave the call.

## Communication cadence

**During the incident:**
- External: update status page within 5 minutes of SEV-1 declaration, then every 30 minutes. "We are investigating an issue affecting X" is always better than silence.
- Internal: Slack incident channel, pinned message, updated on same cadence.
- Escalation: when ETA to resolution is unknown after 30 minutes, escalate one level.

**External message template:**
> We are aware of an issue affecting [feature/service]. Our team is actively investigating. We will provide an update by [time]. [Link to status page]

Never estimate resolution time in external comms unless you have high confidence. "By 3pm PT" that slips twice destroys trust faster than silence.

## MTTR discipline

Mean time to recovery is the metric that matters during an incident. Every step in the response should be evaluated by: "does this reduce MTTR or not?"

Common MTTR killers:
- Running full diagnosis before attempting rollback (rollback first, understand later)
- Waiting for approval from someone not on the call
- Unclear ownership of the remediation step
- Comms blocking on engineering (they should run in parallel)

**Rollback-first rule:** for software incidents, the fastest path to recovery is almost always reverting the most recent change. Diagnose the root cause after the customer impact is gone.

## Blameless postmortem structure

Blameless means the analysis focuses on systems and processes, not on individual error. The goal is improvements that prevent recurrence, not punishment.

**Required sections:**
1. **Timeline**: minute-by-minute reconstruction. Include when monitoring alerted, when the first human noticed, when diagnosis began, when remediation started, when recovery was confirmed.
2. **Impact**: quantified customer impact (users affected, revenue at risk, SLA breached or not).
3. **Root cause**: the systemic factor that made this failure possible. Not "human error", that's never a root cause. Ask "why was this configuration possible?" not "why did the engineer misconfigure it?"
4. **Contributing factors**: secondary conditions that amplified impact or delayed recovery.
5. **Action items**: each item has an owner and a due date. No owner = no item.

**Five-whys for root cause:**
Ask "why" five times until you reach a system-level explanation. Stop when you hit something that a process, test, or monitoring improvement can address.

**Distribution:** share postmortems broadly (engineering-wide, leadership summary). Hoarding postmortems prevents organizational learning.
