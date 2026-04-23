<!--
skills/roles/data-engineer.pipeline.md — Anti-pattern guidance for the Data-engineer.pipeline (pipeline) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-engineer.pipeline (pipeline) domain and counter-moves to avoid them.
Applies to: cx-data-engineer.
-->
---
role: data-engineer.pipeline
applies_to: [cx-data-engineer]
inherits: engineer.data
version: 1
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
