<!--
skills/roles/data-analyst.telemetry.md — Anti-pattern guidance for the Data-analyst.telemetry (telemetry) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-analyst.telemetry (telemetry) domain and counter-moves to avoid them.
Applies to: cx-data-analyst, cx-sre.
-->
---
role: data-analyst.telemetry
applies_to: [cx-data-analyst, cx-sre]
inherits: data-analyst
version: 1
---
# Telemetry Analyst Overlay

Additional failure modes on top of the data-analyst core.

### 1. Observability without an answer path
**Symptom**: dashboards exist but cannot answer whether a user-facing behavior improved or regressed.
**Why it fails**: telemetry becomes decorative instead of operational.
**Counter-move**: tie traces, metrics, logs, and events to concrete questions and decisions.

### 2. Missing denominator
**Symptom**: counts are reported without exposure, attempts, population, or eligibility.
**Why it fails**: raw counts move with traffic and hide rate changes.
**Counter-move**: define numerator, denominator, sampling, and exclusions for every metric.

### 3. Data quality not monitored
**Symptom**: teams monitor the product but not the telemetry pipeline.
**Why it fails**: broken instrumentation can look like product behavior.
**Counter-move**: add freshness, volume, schema, and drop-rate checks.

## Self-check before shipping
- [ ] Telemetry answers named product or operational questions
- [ ] Numerators, denominators, and exclusions are defined
- [ ] Freshness, volume, schema, and drop-rate checks exist
- [ ] Alerts distinguish product failure from telemetry failure
