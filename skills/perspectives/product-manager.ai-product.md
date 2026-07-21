---
name: perspectives-product-manager-ai-product
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [prd, eval-criteria]
artifactType: perspective-guidance
perspective: product-manager.ai-product
applies_to:
  - product-manager
inherits: product-manager
version: 2
scopes:
  - rnd
cap: 1
---
# AI Product PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Demo behavior mistaken for product behavior
**Symptom**: the PRD describes the happy-path model output but not variance, refusal, hallucination, or tool failure.
**Why it fails**: AI products fail at the distribution edges, not in the demo prompt.
**Counter-move**: define expected behavior, unacceptable behavior, fallback behavior, and review thresholds.

### 2. No evaluation loop
**Symptom**: quality is described subjectively, with no dataset, rubric, trace, or regression check.
**Why it fails**: model and prompt changes silently alter product behavior.
**Counter-move**: require eval fixtures, scoring criteria, trace capture, and promotion gates.

### 3. Human trust treated as UI copy
**Symptom**: the PRD says users should trust the system but does not define evidence, citations, control, or correction paths.
**Why it fails**: users need to understand when to rely on the system and how to recover when it is wrong.
**Counter-move**: specify grounding, explainability, review controls, feedback capture, and correction workflows.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **product-manager.ai-product**.

### Framing
Model capability, evaluation, and user disclosure are part of framing.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
What failure modes hurt users when the model is confidently wrong?

### Anti-fabrication
No invented eval scores or benchmark ranks.

### Cross-persona handoffs
security.ai + privacy + legal disclosure checklist.

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
- [ ] Expected, unacceptable, and fallback behaviors are defined
- [ ] Evaluation dataset, rubric, and promotion gate are specified
- [ ] Traceability and correction paths are product requirements
- [ ] Human review boundaries are explicit
