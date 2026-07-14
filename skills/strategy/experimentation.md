---
name: strategy-experimentation
description: "Use when: a change's effect must be measured causally rather than asserted — designing or reading an A/B test, a feature-flag rollout, a canary, or a holdout — so the decision to ship rests on evidence, not the shape of a chart."
inputs: [experiment-plan, metrics]
artifactType: experiment-plan
triggers:
  - experiment
  - a/b test
  - ab test
  - split test
  - feature flag rollout
  - canary
  - holdout
  - sample size
  - statistical power
  - minimum detectable effect
---
# Experimentation

An experiment converts an opinion ("this will help") into a measured causal claim. It is worth running only when the decision is real, the outcome is measurable, and being wrong is expensive enough to pay for the wait. Otherwise it is theater that delays the decision it was meant to inform.

## When to use

Use this to design or read any controlled comparison — an A/B test, a feature-flag percentage rollout, a canary deploy, a geo holdout — where you need to know whether *this change* caused *that effect*, separated from everything else moving at once. It spans roles: an analyst designs and reads it, an engineer implements the assignment and flag, a PM ties it to a hypothesis, operations runs the progressive rollout.

## When not to use

- **One-way-door or trivially cheap changes.** If shipping and reverting is cheap and reversible, just ship and watch the guardrails — an experiment's fixed horizon costs more than the information is worth.
- **No measurable primary metric.** If you cannot name the single number that moves, you are not ready to experiment; do the measurement design first (see the market-research-methods and data-analyst work).
- **Too little traffic to reach the minimum detectable effect in a reasonable window.** Underpowered tests mostly produce noise; use a qualitative method or a bolder change instead.
- **Ethical or trust lines** (dark patterns, withholding a safety fix as a holdout). Don't experiment on those.

## 1. Decide whether to experiment at all

Name the decision the experiment informs and the two actions its outcomes lead to. If a positive and a negative result lead to the *same* action, skip the experiment and act now.

**Symptom**: "let's A/B test it" with no stated decision the result will drive.
**Counter-move**: write "if the primary metric moves ≥ X we ship; if not we revert" before designing anything. No decision rule, no experiment.

## 2. Design before you run

Lock these, in writing, before the first user is exposed:

- **Hypothesis** — the specific causal claim ("adding X raises 7-day retention"), not "let's see what happens."
- **Primary metric** — one number the decision hinges on. One, not five.
- **Guardrail metrics** — the things that must *not* get worse (latency, error rate, revenue, unsubscribes). A win on the primary that breaks a guardrail is not a win.
- **Minimum detectable effect (MDE)** — the smallest change worth acting on. Smaller MDE ⇒ larger sample.
- **Sample size and duration** — computed from baseline rate, MDE, significance (α, typically 0.05), and power (1−β, typically 0.8). Duration must also cover at least one full weekly cycle to absorb day-of-week effects.

**Symptom**: the primary metric is chosen after the data is in, or there are five "primary" metrics.
**Counter-move**: pre-register one primary metric, the guardrails, the MDE, and the analysis plan. Everything discovered later is exploratory, labeled as such.

## 3. Randomize at the right unit

Assign at the unit that matches how users actually experience the change — user, account, workspace, session, request, or geo. Two failure modes dominate:

- **Contamination**: the same person lands in both arms (e.g. logged-out session-level assignment on a cross-device product) — the effect washes out.
- **Interference (SUTVA violation)**: one unit's treatment affects another's outcome (marketplaces, social graphs, shared caches). Randomize at the cluster level (market, region, cohort) when interference is real.

**Symptom**: randomizing by request on a feature users see repeatedly.
**Counter-move**: pick the assignment unit deliberately from how the product is used, and cluster-randomize when units influence each other.

## 4. Run it without peeking

Fixed-horizon tests assume you look **once**, at the pre-declared sample size. Watching the p-value daily and stopping when it dips below 0.05 inflates the false-positive rate far above 5% — the "peeking" problem.

**Symptom**: "it hit significance on day 2, let's call it."
**Counter-move**: either wait for the pre-registered horizon, or adopt a method built for continuous monitoring (sequential testing / always-valid confidence intervals / Bayesian with a pre-set decision boundary) *and declare it up front*.

## 5. Read the result honestly

- **Statistical vs practical significance** — a tiny, significant effect on a huge sample may not be worth shipping; report the effect size and its confidence interval, not just the p-value.
- **Guardrails first** — check them before celebrating the primary.
- **Novelty and primacy effects** — a shiny change spikes then decays, or a disruptive one dips then recovers; a one-week read can invert by week three.
- **Segments** — pre-registered segment cuts are confirmatory; segments you went hunting for after seeing the total are exploratory and need their own confirmation (this is p-hacking otherwise).

**Symptom**: the headline is a p-value and a single overall number.
**Counter-move**: lead with the effect size + confidence interval, confirm guardrails held, and mark any segment finding not pre-registered as a hypothesis for a follow-up, not a result.

## 6. When a clean RCT isn't possible

You often cannot randomize (a pricing change everyone sees, a launched feature, a policy). Use a quasi-experiment and state its identifying assumption explicitly:

- **Difference-in-differences** — treated vs control group, before vs after; assumes parallel trends absent treatment.
- **Interrupted time series** — one series, sharp break at the change; assumes no other change coincided.
- **Regression discontinuity** — units just above vs just below a threshold; assumes they're otherwise comparable.
- **Synthetic control** — a weighted blend of untreated units reconstructs the counterfactual.

**Symptom**: a before/after comparison presented as if it were an RCT.
**Counter-move**: name the assumption the design leans on, and the confounder that would break it, in the same paragraph as the estimate.

## State the assumption that would break it

Every experiment rests on assumptions (no interference, no coincident change, stable population, correct instrumentation). Before publishing the result, write the single assumption that, if violated, would most likely invalidate the conclusion — and how you checked it. A result with no stated failure assumption is a chart, not evidence.

## Output

Produce an experiment plan (or read-out): hypothesis, primary metric + guardrails, randomization unit, MDE with the sample size and duration it implies, the analysis plan, and the ship/iterate/kill decision rule — and, on read-out, the effect size with its interval, the guardrail check, and the assumption most likely to invalidate it.
