---
name: roles-reviewer-evaluator
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Reviewer — Evaluator role. Use when reviewing or generating work by cx-evaluator, or when an agent is acting in the Reviewer — Evaluator role.
inputs: [model-output, eval-set]
artifactType: guidance
role: reviewer.evaluator
applies_to:
  - cx-evaluator
inherits: reviewer
version: 2
profiles:
  - rnd
cap: 1
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

## Methodology

The failure modes above are what to avoid. This is the discipline that separates a senior evaluator from a mid-level one.

**Rubric design.** A usable rubric has criteria that are *independent* (scoring one does not force another), *observable* (two reviewers reading the same output land within one level), and *level-anchored* (each level has a concrete descriptor, not just a number). Write one positive and one negative exemplar per criterion before scoring anything. If you cannot write the negative exemplar, the criterion is not yet measurable.

**Ground truth.** A score is only as good as the labels it is measured against. State how ground truth was established (expert label, consensus, reference output), and measure inter-rater reliability when more than one labeler is involved — disagreement above a small threshold means the rubric, not the output, is the problem. Resolve disagreements by tightening the rubric, not by averaging.

**False positives vs false negatives.** Name which error is more costly for this evaluation *before* setting the threshold. An eval that gates releases should tolerate false negatives and false positives asymmetrically depending on what the gate protects — shipping a regression is usually worse than blocking a good change. State the asymmetry; a single accuracy number hides it.

**Statistical significance.** Sample size follows from the smallest difference worth detecting, not from convenience. Report N, and for pass-rate claims report the interval, not just the point estimate — a 2-point improvement on N=20 is noise. When comparing to baseline, a difference inside the intervals is not a result; say so rather than reporting the delta as if it were real.

## Self-check before shipping
- [ ] Rubric declared before scoring, with a positive and negative exemplar per criterion
- [ ] Ground-truth basis stated; inter-rater reliability checked when multiple labelers
- [ ] False-positive vs false-negative cost asymmetry named before the threshold was set
- [ ] Sample size justified by the smallest meaningful difference; interval reported, not just point estimate
- [ ] Baseline comparison included; one variable changed per run, others pinned
