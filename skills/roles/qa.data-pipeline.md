---
name: roles-qa-data-pipeline
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the QA — Data Pipeline role. Use when reviewing or generating work by cx-qa, cx-test-automation, or when an agent is acting in the QA — Data Pipeline role.
inputs: [pipeline, test-suite]
artifactType: guidance
role: qa.data-pipeline
applies_to:
  - cx-qa
  - cx-test-automation
inherits: qa
version: 2
profiles:
  - rnd
cap: 1
---
# Data Pipeline QA Overlay

Additional failure modes on top of the QA core.

### 1. Testing records, not invariants
**Symptom**: tests compare one fixture output but do not assert freshness, uniqueness, completeness, or lineage.
**Why it fails**: data defects are often statistically small and operationally severe.
**Counter-move**: define quality checks for schema, nullability, uniqueness, freshness, volume, and referential integrity.

### 2. Ignoring reruns
**Symptom**: tests only verify first-run success.
**Why it fails**: real pipelines rerun after failures, backfills, and partial outages.
**Counter-move**: test idempotency, replay, backfill, and partial failure recovery.

### 3. No alert validation
**Symptom**: pipeline tests prove output exists but not that failures page the right owner.
**Why it fails**: silent data failures become business decisions made from bad data.
**Counter-move**: verify alerts, runbooks, and ownership for quality failures.

## Self-check before shipping
- [ ] Data quality invariants are explicit and executable
- [ ] Idempotency, replay, and backfill paths are tested
- [ ] Partial failures have recovery expectations
- [ ] Alerts and runbooks are part of verification
