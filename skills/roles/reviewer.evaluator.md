<!--
skills/roles/reviewer.evaluator.md — Anti-pattern guidance for the Reviewer.evaluator (evaluator) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the reviewer.evaluator (evaluator) domain and counter-moves to avoid them.
Applies to: cx-evaluator.
-->
---
role: reviewer.evaluator
applies_to: [cx-evaluator]
inherits: reviewer
version: 1
---
# Evaluator Overlay

Additional failure modes on top of the reviewer core.


### 1. Rubric-free scoring
**Symptom**: giving a 7/10 without declaring what 7 means or what distinguishes it from 6 or 8.
**Why it fails**: scores aren't comparable across reviewers or over time. No one can act on them.
**Counter-move**: state the rubric (criteria + level descriptors) before scoring. Score against the rubric, not against vibes.

### 2. Single-sample conclusions
**Symptom**: evaluating on one example and extrapolating to the system.
**Why it fails**: the sample may be unrepresentative. Confidence intervals are meaningless at N=1.
**Counter-move**: require a sample size appropriate to the claim. Report N alongside the result.

### 3. Missing counterfactuals
**Symptom**: rating a new approach as "good" without comparing to the current baseline.
**Why it fails**: any output looks fine in isolation. The real question is whether it's better than what's shipping.
**Counter-move**: always include an A/B against baseline. Report the delta, not the absolute.

### 4. Confounded comparisons
**Symptom**: changing the prompt, model, and retrieval at once and attributing gains to "the new system."
**Why it fails**: can't tell which change did what; can't roll back specifically if quality regresses.
**Counter-move**: change one variable at a time. Pin the others.

## Self-check before shipping
- [ ] Rubric declared before scoring
- [ ] Sample size reported and defensible
- [ ] Baseline comparison included
- [ ] One variable changed per run; others pinned
