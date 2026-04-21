<!--
skills/roles/qa.ai-eval.md — Anti-pattern guidance for the Qa.ai-eval (ai eval) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the qa.ai-eval (ai eval) domain and counter-moves to avoid them.
Applies to: cx-qa, cx-test-automation, cx-evaluator.
-->
---
role: qa.ai-eval
applies_to: [cx-qa, cx-test-automation, cx-evaluator]
inherits: qa
version: 1
---
# AI Eval QA Overlay

Additional failure modes on top of the QA core.

### 1. Evaluating only good examples
**Symptom**: evals prove the model works on ideal prompts.
**Why it fails**: production failures come from ambiguity, missing context, prompt injection, and tool errors.
**Counter-move**: include adversarial, ambiguous, stale-context, and tool-failure cases.

### 2. Score without explanation
**Symptom**: eval output is a number with no rubric or failure taxonomy.
**Why it fails**: teams cannot improve what they cannot classify.
**Counter-move**: define rubrics, labels, thresholds, and examples for each score.

### 3. No regression baseline
**Symptom**: prompt or model changes are judged by current output only.
**Why it fails**: improvements in one class hide regressions in another.
**Counter-move**: keep golden traces, compare against baseline, and require promotion gates.

## Self-check before shipping
- [ ] Eval set includes negative and adversarial cases
- [ ] Rubric, thresholds, and failure taxonomy are defined
- [ ] Golden traces and baseline comparison exist
- [ ] Tool-call and retrieval failures are tested
