---
name: perspectives-data-analyst-telemetry
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [telemetry, metrics]
artifactType: perspective-guidance
perspective: data-analyst.telemetry
applies_to:
  - data-analyst
  - operations
inherits: data-analyst
version: 2
scopes:
  - rnd
cap: 1
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



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **data-analyst.telemetry**.

### Framing
Event schema, privacy minimization, quality monitors.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Missing events that look like product failure.

### Anti-fabrication
No invented event volumes.

### Cross-persona handoffs
privacy for identifiers.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions; avoid spaced em dashes; refuse LLM tells; careful colleague tone. Exceptions: ACs, legal shall/must, quotes, exact section titles.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping
- [ ] Telemetry answers named product or operational questions
- [ ] Numerators, denominators, and exclusions are defined
- [ ] Freshness, volume, schema, and drop-rate checks exist
- [ ] Alerts distinguish product failure from telemetry failure
