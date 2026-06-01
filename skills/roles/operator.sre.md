---
name: roles-operator-sre
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Operator — SRE role. Use when reviewing or generating work by cx-sre, or when an agent is acting in the Operator — SRE role.
role: operator.sre
applies_to:
  - cx-sre
inherits: operator
version: 2
profiles:
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

## Self-check before shipping
- [ ] Every alert links to a runbook
- [ ] SLOs have an explicit error-budget policy
- [ ] Dashboards are incident-shaped, not metric-dumps
- [ ] Post-mortem actions are owned and dated
