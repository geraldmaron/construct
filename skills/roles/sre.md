---
name: roles-operator-sre
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Operator — SRE role. Use when reviewing or generating work by cx-sre, or when an agent is acting in the Operator — SRE role.
inputs: [alert-config, slo]
artifactType: role-guidance
role: sre
applies_to:
  - cx-sre
inherits: operations
version: 2
scopes:
  - rnd
cap: 1
---
# SRE Overlay

Additional failure modes on top of the operator core.


### 1. Alerts without playbooks
**Symptom**: an alert page triggers but has no linked runbook or known response.
**Why it fails**: oncall wakes, fumbles, escalates. Mean time to recovery balloons.
**Counter-move**: every alert links to a runbook with symptoms, checks, and remediation steps.

### 2. SLOs without error budgets
**Symptom**: publishing an SLO (e.g., 99.9% availability) with no policy for what happens when it's breached.
**Why it fails**: the SLO becomes decorative; feature work continues to burn reliability.
**Counter-move**: define the error budget policy up front. what freezes, who's notified, when it resumes.

### 3. Dashboards of everything
**Symptom**: 40-panel dashboards covering every metric the team could expose.
**Why it fails**: during an incident, nobody can find the signal. Cognitive load blocks response.
**Counter-move**: build incident-shaped dashboards: one per symptom class, with the minimum signals to triage.

### 4. Post-mortems without corrective actions
**Symptom**: writing a thorough timeline and "5 whys" with no tracked owner or deadline for fixes.
**Why it fails**: the same incident repeats. Teams lose trust in the process.
**Counter-move**: every corrective action has an owner, a ticket, and a target date. Review completion in the next monthly.

## Methodology

The error-budget policy is the mechanism that makes an SLO consequential ([Google SRE](https://sre.google/workbook/error-budget-policy/)):

- The budget is `1 − SLO` over a window (99.9% over 28 days ≈ 43 min of allowed downtime). It is spent by every failure, planned or not.
- **Burn rate** is how fast the budget is being consumed relative to the window. Alert on burn rate with **multi-window** thresholds — a fast-burn alert (e.g. 2% of budget in 1 hour) pages now; a slow-burn alert (e.g. 10% over a few days) opens a ticket. This pages on severity, not on every blip, which is what kills alert fatigue.
- **The policy is written before the breach**: when the budget is exhausted, feature releases freeze and reliability work takes priority until it recovers; name the exceptions (infra failures, third-party) and who can override. The freeze is the forcing function that balances velocity against reliability — without it the SLO is decorative.

## Self-check before shipping
- [ ] Every alert links to a runbook
- [ ] SLOs have an explicit, written-before-breach error-budget policy (freeze trigger, exceptions, owner)
- [ ] Burn-rate alerting uses multi-window thresholds (fast-burn pages, slow-burn ticket)
- [ ] Dashboards are incident-shaped, not metric-dumps
- [ ] Post-mortem actions are owned and dated
