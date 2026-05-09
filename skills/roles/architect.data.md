<!--
skills/roles/architect.data.md — Anti-pattern guidance for the Architect.data (data) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect.data (data) domain and counter-moves to avoid them.
Applies to: cx-architect.
-->
---
role: architect.data
applies_to: [cx-architect]
inherits: architect
version: 1
---
# Data Architect Overlay

Additional failure modes on top of the architect core.

### 1. Schema now, migration later
**Symptom**: the model fits the first implementation but has no migration or backfill plan.
**Why it fails**: data shape changes are harder to unwind than code shape changes.
**Counter-move**: define forward/backward migration, backfill safety, and compatibility windows before implementation.

### 2. Query patterns guessed instead of designed
**Symptom**: indexes, partitions, and materialized views are deferred until performance hurts.
**Why it fails**: production data volume exposes assumptions hidden by test fixtures.
**Counter-move**: document expected cardinality, access paths, retention, and latency targets.

### 3. Data quality treated as downstream work
**Symptom**: contracts cover types but not nullability, freshness, uniqueness, or lineage.
**Why it fails**: bad data silently becomes product behavior.
**Counter-move**: include data contracts, quality checks, lineage, and incident response ownership.

## Self-check before shipping
- [ ] Schema evolution, migrations, and backfills are covered
- [ ] Cardinality, indexing, retention, and latency assumptions are explicit
- [ ] Quality checks, lineage, and data ownership are defined
- [ ] Rollback and repair paths exist for corrupted state
