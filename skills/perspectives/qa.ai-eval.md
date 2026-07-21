---
name: perspectives-qa-ai-eval
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [eval-set, model-output]
artifactType: guidance
perspective: qa.ai-eval
applies_to:
  - qa
  - reviewer
inherits: qa
version: 2
scopes:
  - rnd
cap: 1
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



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **qa.ai-eval**.

### Framing
Eval sets, scorers, regression gates.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Eval set contamination and metric hacking.

### Anti-fabrication
No invented eval leaderboard positions.

### Cross-persona handoffs
security.ai for abuse cases.

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
- [ ] Eval set includes negative and adversarial cases
- [ ] Rubric, thresholds, and failure taxonomy are defined
- [ ] Golden traces and baseline comparison exist
- [ ] Tool-call and retrieval failures are tested
