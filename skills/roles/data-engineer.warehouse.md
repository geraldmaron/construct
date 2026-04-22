<!--
skills/roles/data-engineer.warehouse.md — Anti-pattern guidance for the Data-engineer.warehouse (warehouse) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-engineer.warehouse (warehouse) domain and counter-moves to avoid them.
Applies to: cx-data-engineer.
-->
---
role: data-engineer.warehouse
applies_to: [cx-data-engineer]
inherits: engineer.data
version: 1
---
# Warehouse Engineer Overlay

Additional failure modes on top of the data engineer core.

### 1. Modeling for the first question
**Symptom**: tables answer one dashboard but cannot support future slicing or audit.
**Why it fails**: warehouse models become brittle semantic traps.
**Counter-move**: define grains, dimensions, facts, slowly changing attributes, and ownership.

### 2. Semantic duplication
**Symptom**: the same metric exists in several SQL files with different filters.
**Why it fails**: teams argue over numbers instead of decisions.
**Counter-move**: centralize metric definitions and document denominator, exclusions, and freshness.

### 3. Cost ignored
**Symptom**: transformations are correct but expensive or slow at production volume.
**Why it fails**: analytics reliability includes cost and latency.
**Counter-move**: design partitions, clustering, incremental models, and retention explicitly.

## Self-check before shipping
- [ ] Grain, dimensions, facts, and ownership are documented
- [ ] Metrics are centralized with denominators and exclusions
- [ ] Incremental strategy, partitions, and retention are defined
- [ ] Cost and latency are acceptable at expected volume
