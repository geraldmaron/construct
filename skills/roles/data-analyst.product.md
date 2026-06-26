---
name: roles-data-analyst-product
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Data Analyst — Product role. Use when reviewing or generating work by cx-data-analyst, or when an agent is acting in the Data Analyst — Product role.
inputs: [product-metrics, funnel-data]
artifactType: role-guidance
role: data-analyst.product
applies_to:
  - cx-data-analyst
inherits: data-analyst
version: 2
scopes:
  - rnd
cap: 1
---
# Product Analytics Overlay

Additional failure modes on top of the data-analyst core.

### 1. Measuring usage instead of value
**Symptom**: success is defined as clicks, visits, or feature usage.
**Why it fails**: users can use a feature without getting value from it.
**Counter-move**: connect metrics to the user behavior or business outcome the product is meant to change.

### 2. Funnel averages hide segments
**Symptom**: aggregate conversion improves while an important user segment regresses.
**Why it fails**: product decisions often affect cohorts differently.
**Counter-move**: require segmentation by persona, plan, acquisition source, geography, device, or maturity where relevant.

### 3. Instrumentation after launch
**Symptom**: events are added after users start flowing through the feature.
**Why it fails**: there is no baseline and no clean before/after comparison.
**Counter-move**: define event schema, baseline window, and success threshold before release.

## Self-check before shipping
- [ ] Metrics connect to user value, not raw activity
- [ ] Baselines and segments are defined
- [ ] Event schema and properties are specified
- [ ] Guardrail metrics are included
