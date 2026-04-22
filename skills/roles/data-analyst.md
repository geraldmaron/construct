<!--
skills/roles/data-analyst.md — Anti-pattern guidance for the Data-analyst role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-analyst domain and counter-moves to avoid them.
Applies to: cx-data-analyst.
-->
---
role: data-analyst
applies_to: [cx-data-analyst]
inherits: null
version: 1
---
# Data Analyst — Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output — check your draft against each.


### 1. Metric without definition
**Symptom**: a metric cited without its precise definition — which events, what time window, deduplication rules, filters.
**Why it fails**: two teams compute "active users" differently. Decisions rest on numbers nobody can reproduce.
**Counter-move**: name the metric and its SQL-level or event-level definition before any number. Version the definition.

### 2. Vanity over outcome
**Symptom**: reports lead with impressions, pageviews, clicks — activity disconnected from whether users got value.
**Why it fails**: rewards teams for moving activity numbers while outcomes stagnate.
**Counter-move**: tie every vanity metric to an outcome metric. Report both. Lead with the outcome.

### 3. Ignoring data quality
**Symptom**: analysis assumes the underlying events fire correctly, are deduped, and have consistent schemas.
**Why it fails**: real pipelines drop, duplicate, and malform events. Analysis without QA produces confident wrong numbers.
**Counter-move**: run sanity checks — row counts, null rates, distribution shape, schema checks — before analysis. Report data quality alongside findings.

### 4. Correlation as causation
**Symptom**: "users who did X had higher retention" presented as a reason to make everyone do X.
**Why it fails**: selection bias, reverse causation, and confounders produce the same pattern. Actions based on it rarely work.
**Counter-move**: name the alternative explanations. If you want to claim causation, the answer is an experiment.

### 5. p-hacking and post-hoc slicing
**Symptom**: after seeing the results, the analyst carves the data until a significant effect appears somewhere.
**Why it fails**: guaranteed to find "effects" that are noise. Decisions based on them do not replicate.
**Counter-move**: register hypotheses before looking at the data. Distinguish confirmatory from exploratory findings.

### 6. Missing funnel context
**Symptom**: a conversion rate reported without the volume at each step, or a step-change reported without the broader funnel.
**Why it fails**: a "20% lift" on a step that 1% of users reach moves nothing. Context collapses.
**Counter-move**: every rate comes with its denominator and its place in the funnel. Report absolute as well as relative.

### 7. Dashboard as deliverable
**Symptom**: the analyst builds a dashboard and stops. No interpretation, no recommendation, no action.
**Why it fails**: stakeholders read numbers without knowing what to do with them; dashboards accumulate but decisions do not.
**Counter-move**: every analysis ends with interpretation and a recommended action. Dashboards support that, they do not replace it.

### 8. Unreproducible analysis
**Symptom**: the number came from a notebook on someone's laptop; the query is not saved; the result cannot be regenerated.
**Why it fails**: the analysis cannot be audited, extended, or re-run against fresh data. Trust erodes when numbers cannot be reproduced.
**Counter-move**: code in a repo, queries in version control, inputs and outputs documented. A colleague can re-run the analysis tomorrow.

## Self-check before shipping

- [ ] Every metric has a precise, versioned definition
- [ ] Outcome metrics lead; vanity metrics support or are omitted
- [ ] Data quality checks run; quality reported with findings
- [ ] Correlations explicitly separated from causal claims
- [ ] Hypotheses registered before seeing the data
- [ ] Rates include denominators and funnel context
- [ ] Interpretation and recommended action accompany numbers
- [ ] Analysis is reproducible from version-controlled artifacts
