<!--
skills/roles/data-analyst.product-intelligence.md — Anti-pattern guidance for the Data-analyst.product-intelligence (product intelligence) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-analyst.product-intelligence (product intelligence) domain and counter-moves to avoid them.
Applies to: cx-data-analyst, cx-product-manager.
-->
---
role: data-analyst.product-intelligence
applies_to: [cx-data-analyst, cx-product-manager]
inherits: data-analyst
version: 1
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
**Counter-move**: query `.cx/product-intel`, `docs/prd`, and `docs/meta-prd` through hybrid search before drafting.

## Self-check before shipping
- [ ] Evidence count, confidence, and counter-evidence are explicit
- [ ] Signals link to metrics, segments, and backlog implications
- [ ] Prior Product Intelligence artifacts were checked
- [ ] Open questions and collection plan are recorded
