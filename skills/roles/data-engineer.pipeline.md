---
name: roles-data-engineer-pipeline
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Data Engineer — Pipeline role. Use when reviewing or generating work by cx-data-engineer, or when an agent is acting in the Data Engineer — Pipeline role.
inputs: [pipeline-design, data-contract]
artifactType: role-guidance
role: data-engineer.pipeline
applies_to:
  - cx-engineer
inherits: data-engineer
version: 2
scopes:
  - rnd
cap: 1
---
# Data Pipeline Engineer Overlay

Additional failure modes on top of the data engineer core.

### 1. Non-idempotent jobs
**Symptom**: reruns duplicate records, skip records, or mutate state unpredictably.
**Why it fails**: retries and backfills are normal operations, not edge cases.
**Counter-move**: design idempotency keys, checkpoints, replay windows, and deduplication rules.

### 2. Hidden failure states
**Symptom**: jobs fail silently or require manual log archaeology.
**Why it fails**: data consumers keep making decisions from stale or partial data.
**Counter-move**: add freshness, volume, schema, latency, and error-rate monitors with owners.

### 3. Contract drift
**Symptom**: upstream fields change without downstream tests failing.
**Why it fails**: data breaks at the consumer boundary.
**Counter-move**: publish contracts and run compatibility checks before deploy.

## Methodology

The monitors above tell you a job broke; lineage and SLAs tell you what it broke and whether that matters.

**Lineage.** Every dataset should trace column-to-column from source to consumer, so that when a value is wrong you can answer "what fed this" and "what depends on this" without log archaeology. Capture lineage as metadata (which job, which inputs, which transform), not tribal knowledge; it is what makes an incident's blast radius computable.

**Data SLAs / SLOs.** A pipeline without a stated freshness and completeness target has no definition of "broken." Set an SLA per consumed dataset (e.g. "fresh within 1h, 99.5% of rows present") and alert against the SLO, not against raw job status — a job that "succeeded" but delivered half the rows is a breach. Tie the SLA to the consumer's actual decision cadence, not to convenience.

**Observability maturity.** Progress from "is the job green" → "is the data fresh and complete" → "is the distribution sane" (volume/null-rate/value drift). The last catches the silent corruption the first two miss.

## Self-check before shipping
- [ ] Reruns, retries, and backfills are idempotent
- [ ] Column-level lineage from source to consumer is captured as metadata
- [ ] A freshness/completeness SLA exists per consumed dataset; alerts fire on SLO breach, not just job failure
- [ ] Distribution monitors (volume, null-rate, value drift) exist, not just success/failure
- [ ] Data contracts and compatibility tests are present
- [ ] Ownership and runbook are clear
