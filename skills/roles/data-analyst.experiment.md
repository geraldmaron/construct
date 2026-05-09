<!--
skills/roles/data-analyst.experiment.md — Anti-pattern guidance for the Data-analyst.experiment (experiment) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-analyst.experiment (experiment) domain and counter-moves to avoid them.
Applies to: cx-data-analyst.
-->
---
role: data-analyst.experiment
applies_to: [cx-data-analyst]
inherits: data-analyst
version: 1
---
# Experiment Analyst Overlay

Additional failure modes on top of the data-analyst core.

### 1. Experiment without a decision rule
**Symptom**: the team plans to "see what happens" after launch.
**Why it fails**: ambiguous outcomes become arguments instead of decisions.
**Counter-move**: define hypothesis, primary metric, guardrails, minimum detectable effect, and stop rule.

### 2. Randomization mismatch
**Symptom**: randomization unit does not match how users experience the product.
**Why it fails**: contamination and repeated exposure distort the result.
**Counter-move**: choose user, account, workspace, session, or request-level assignment deliberately.

### 3. Reading results too early
**Symptom**: decisions are made on partial data because the chart looks convincing.
**Why it fails**: early peeking inflates false positives.
**Counter-move**: specify duration, sample size, and analysis plan before the experiment starts.

## Self-check before shipping
- [ ] Hypothesis, primary metric, guardrails, and stop rule are explicit
- [ ] Randomization unit matches the product behavior
- [ ] Sample size and duration are justified
- [ ] Segmentation and novelty effects are considered
