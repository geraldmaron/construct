---
name: perspectives-product-manager-product
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [prd, task-context]
artifactType: guidance
perspective: product-manager.product
applies_to:
  - product-manager
inherits: product-manager
version: 2
scopes:
  - rnd
cap: 1
---
# Product PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Persona theater
**Symptom**: the document names a generic user such as "admin" or "customer" without describing the workflow, pressure, or context they are in.
**Why it fails**: generic personas cannot drive product tradeoffs; every stakeholder imagines a different user.
**Counter-move**: anchor the persona in a concrete job, trigger, current workaround, and success condition.

### 2. Workflow gaps hidden behind feature language
**Symptom**: requirements describe screens or features but skip the before, during, and after steps of the user journey.
**Why it fails**: engineering can ship the feature while the actual workflow still breaks at handoff points.
**Counter-move**: write the end-to-end user workflow and mark where the new capability changes behavior.

### 3. Adoption assumed
**Symptom**: success depends on users discovering, trusting, and repeatedly using the feature, but the PRD says nothing about adoption.
**Why it fails**: usable features still fail when activation, migration, onboarding, or trust are unresolved.
**Counter-move**: include the first-use path, repeat-use trigger, and measurable adoption signal.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **product-manager.product**.

### Framing
Customer-facing capability framing: who hurts, how often, what outcome changes.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Would a skeptical customer believe the outcome claim from the cited evidence alone?

### Anti-fabrication
No fabricated NPS, conversion, or churn deltas.

### Cross-persona handoffs
User research + competitive landscape required when claiming differentiation.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions (`it's`, not `it is` when natural); prefer longer connected sentences over staccato fragments; avoid spaced em dashes; refuse LLM tells and keynote/Disney uplift; careful colleague tone with mild warmth only when earned. Exceptions: ACs, legal shall/must, quotes, exact section titles. Treat attention and trust as craft inputs, not inspirational set pieces.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping
- [ ] Persona includes workflow context, not just role title
- [ ] End-to-end user journey is explicit
- [ ] Adoption path and repeat-use trigger are named
- [ ] Success metric measures user outcome, not shipped scope
