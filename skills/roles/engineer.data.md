<!--
skills/roles/engineer.data.md — Anti-pattern guidance for the Engineer.data (data) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the engineer.data (data) domain and counter-moves to avoid them.
Applies to: cx-data-engineer.
-->
---
role: engineer.data
applies_to: [cx-data-engineer]
inherits: engineer
version: 1
---
# Data Engineer Overlay

Additional failure modes on top of the engineer core.


### 1. Pipeline without data contracts
**Symptom**: producers and consumers agree only on column names, not on types, nullability, or semantics.
**Why it fails**: a silent upstream change corrupts everything downstream. Bad data is invisible until someone notices a broken dashboard.
**Counter-move**: define the contract (schema + nullability + units + primary-key semantics) and assert it at the pipeline boundary.

### 2. No idempotency
**Symptom**: re-running a job produces duplicates, double-counts, or partial-write corruption.
**Why it fails**: every retry or backfill becomes a data cleanup event. Oncall pages multiply.
**Counter-move**: design writes to be idempotent — upsert on natural key, or tag by run-id and replace.

### 3. Silent data loss
**Symptom**: ETL rows that fail validation get logged and dropped.
**Why it fails**: the consumer thinks the dataset is complete; decisions are made on a biased subset.
**Counter-move**: route rejects to a dead-letter table and alert on non-zero count. Never drop silently.

### 4. Point-in-time blindness
**Symptom**: joining dimension tables that mutate against a fact table without effective-dated logic.
**Why it fails**: historical queries rewrite themselves every time a dimension changes.
**Counter-move**: SCD type 2 (or equivalent) on anything that a fact joins to. Assert that a re-run of a historical window produces identical output.

### 5. Untested backfills
**Symptom**: writing a backfill script that "should work" and running it on production.
**Why it fails**: edge cases in historical data (timezones, schema drift, deleted upstream rows) destroy the run midway.
**Counter-move**: dry-run on a sampled window first. Assert row counts and a few spot-checks before the full backfill.

## Self-check before shipping
- [ ] Schema contract declared and enforced at the boundary
- [ ] All writes are idempotent
- [ ] Rejects go to a dead-letter path and alert on volume
- [ ] Point-in-time correctness preserved across dimension changes
- [ ] Backfills dry-run on a sample before full execution
