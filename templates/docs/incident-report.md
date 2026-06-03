# Incident Report: {title}

- **Incident ID**: {INC-NNNN}
- **Date**: {YYYY-MM-DD}
- **Severity**: SEV-1 | SEV-2 | SEV-3
- **Duration**: {detection} → {all-clear} ({total}; time-to-detect {ttd}, time-to-mitigate {ttm})
- **Authors**: {names — include everyone who responded}
- **Status**: draft | final

<!--
Blameless postmortem. Describe systems and decisions, not people. Neutral, factual
language — no dramatic or animated descriptions. Publish within days while detail is
fresh, and share widely. See Google SRE postmortem culture:
https://sre.google/workbook/postmortem-culture/
-->

## Summary
<!-- Two to four sentences: what happened, who was affected, how it was resolved. Blameless tone. -->

## Severity rationale
<!-- Why this severity and not one higher or lower? State the criteria (user impact, data integrity, duration, blast radius). If it was reclassified mid-incident, say when and why. -->

## Impact
<!-- Quantify: users affected, requests failed, error rate, revenue, data-integrity consequences. "Unknown" is acceptable; a guess is not. -->

## Timeline
<!-- Times in UTC, one line per event. Mark the key transitions explicitly: detection, diagnosis, mitigation start, resolution, all-clear. The gaps between them are the response story. -->

| Time (UTC) | Event | Phase |
|------------|-------|-------|
| {HH:MM}    | {what happened or was done} | detection / diagnosis / mitigation / resolution |

## Trigger
<!-- The proximate cause — the specific change, event, or input that set the incident off (a deploy, a traffic spike, a dependency failure). Distinct from the root cause. -->

## Root cause
<!-- The underlying system condition that let the trigger cause harm. The five-whys, condensed. A root cause is a system/design gap, never a person. -->

## Contributing factors
<!-- Conditions that made the incident possible, worse, or harder to resolve: missing alerts, brittle dependencies, process gaps, absent runbook. Not the root cause, but they shaped the outcome. -->

## Mitigators
<!-- What went right and reduced blast radius — a circuit breaker that tripped, a canary that caught it, a fast rollback. These are as instructive as the failures; preserve them. -->

## Detection and response
<!-- How was it detected (alert, customer report, dashboard)? Was detection fast enough? What slowed diagnosis or mitigation? Be specific and blameless. -->

## Action items
<!-- Each action: systemic fix preferred over "be more careful". Owner, priority, and tracking ID required. Priority: P0 (prevents recurrence, do now) → P2 (hardening). -->

| Action | Type (prevent/detect/mitigate) | Owner | Priority | Tracking |
|--------|--------------------------------|-------|----------|----------|
| {what} | {prevent/detect/mitigate}      | {who} | P0/P1/P2 | {bd or ticket} |

## Lessons learned
<!-- Organized by theme. What did this reveal about the system or the organization that generalizes beyond this incident? -->

## Glossary
<!-- Define domain-specific terms, service names, and acronyms used above so a reader outside the team can follow the report. -->

## References
<!-- Logs, dashboards, traces (with IDs preserved), related incidents, the PRs that caused and that fixed the issue. -->
