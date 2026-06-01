---
name: roles-data-engineer-pipeline
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Data Engineer — Pipeline role. Use when reviewing or generating work by cx-data-engineer, or when an agent is acting in the Data Engineer — Pipeline role.
role: data-engineer.pipeline
applies_to:
  - cx-data-engineer
inherits: engineer.data
version: 2
profiles:
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

## Self-check before shipping
- [ ] Reruns, retries, and backfills are idempotent
- [ ] Freshness, volume, schema, latency, and error monitors exist
- [ ] Data contracts and compatibility tests are present
- [ ] Ownership and runbook are clear
