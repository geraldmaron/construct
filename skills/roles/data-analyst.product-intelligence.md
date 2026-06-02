---
name: roles-data-analyst-product-intelligence
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Data Analyst — Product Intelligence role. Use when reviewing or generating work by cx-data-analyst, cx-product-manager, or when an agent is acting in the Data Analyst — Product Intelligence role.
inputs: [customer-signals, telemetry]
artifactType: role-guidance
role: data-analyst.product-intelligence
applies_to:
  - cx-data-analyst
  - cx-product-manager
inherits: data-analyst
version: 2
profiles:
  - rnd
cap: 1
---
# Product Intelligence Analyst Overlay

Additional failure modes on top of the data-analyst core.

### 1. Anecdotes counted as evidence
**Symptom**: customer notes are summarized without source count, confidence, or contradiction.
**Why it fails**: loud examples masquerade as trends.
**Counter-move**: separate signal, evidence, confidence, counter-evidence, and unresolved questions.

### 2. Qualitative and quantitative data never meet
**Symptom**: support themes, interviews, telemetry, and roadmap work remain separate artifacts.
**Why it fails**: PM decisions lack a durable evidence trail.
**Counter-move**: link customer signals to metrics, segments, affected workflows, and backlog proposals.

### 3. Evidence store ignored
**Symptom**: new briefs are written without checking prior Product Intelligence artifacts.
**Why it fails**: teams rediscover the same signal and lose longitudinal context.
**Counter-move**: query `.cx/knowledge`, `docs/prd`, and `docs/meta-prd` through hybrid search before drafting.

## Self-check before shipping
- [ ] Evidence count, confidence, and counter-evidence are explicit
- [ ] Signals link to metrics, segments, and backlog implications
- [ ] Prior Product Intelligence artifacts were checked
- [ ] Open questions and collection plan are recorded
