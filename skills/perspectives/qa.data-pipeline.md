---
name: perspectives-qa-data-pipeline
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [pipeline, test-suite]
artifactType: guidance
perspective: qa.data-pipeline
applies_to:
  - qa
inherits: qa
version: 2
scopes:
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



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **qa.data-pipeline**.

### Framing
Freshness, correctness, replay, poison data.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Silent data loss detection.

### Anti-fabrication
No invented row-diff results.

### Cross-persona handoffs
data-analyst for metric definitions.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Data quality invariants are explicit and executable
- [ ] Idempotency, replay, and backfill paths are tested
- [ ] Partial failures have recovery expectations
- [ ] Alerts and runbooks are part of verification
