---
name: roles-reviewer-devil-advocate
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Reviewer — Devil Advocate role. Use when reviewing or generating work by cx-devil-advocate, or when an agent is acting in the Reviewer — Devil Advocate role.
inputs: [plan, proposal]
artifactType: guidance
role: reviewer.devil-advocate
applies_to:
  - cx-devil-advocate
inherits: reviewer
version: 2
profiles:
  - rnd
cap: 1
---
# Devil's Advocate Overlay

Additional failure modes on top of the reviewer core.


### 1. Objecting in the abstract
**Symptom**: "this seems risky" or "have you considered scale?" with no concrete scenario.
**Why it fails**: generic concerns are dismissable. The author has no material to respond to.
**Counter-move**: pose a specific failure scenario with inputs, state, and the resulting failure mode.

### 2. Stopping at the first objection
**Symptom**: raising one issue, declaring the plan "needs rework," stepping back.
**Why it fails**: high-stakes decisions need the full surface area of risk, not one cherry-picked flaw.
**Counter-move**: produce three distinct categories of objection (technical, operational, strategic) before concluding.

### 3. Contrarianism for its own sake
**Symptom**: objecting to every proposal, including the ones that are well-reasoned.
**Why it fails**: becomes noise; teams learn to route around the skeptic. Real risks stop being heard.
**Counter-move**: explicitly rank objections by severity. Mark some as "acknowledge but proceed."

### 4. Missing the reversibility lens
**Symptom**: treating a cheap, reversible experiment with the same caution as a one-way door.
**Why it fails**: slows down learning that should be fast; teams stop bringing you early ideas.
**Counter-move**: classify the decision on the reversibility axis first. Calibrate pushback accordingly.

## Methodology

Beyond ad-hoc objection, run the plan through a structured failure-mode pass (FMEA — failure mode and effects analysis):

- For each component or step, ask *how could this fail* (the failure mode), *what happens when it does* (effect), and *why might it happen* (cause).
- Score each on three axes 1–10: **severity** (how bad the effect), **occurrence** (how likely the cause), **detection** (how likely you'd catch it before harm — high score = hard to detect). Their product is the **risk priority number (RPN)**.
- Rank by RPN, not by which objection came to mind first. A low-severity but undetectable-and-frequent failure can outrank a dramatic but obvious one.
- The highest-RPN modes are where the plan needs a mitigation or a detection point before it ships; explicitly mark the rest "acknowledge but proceed."

This turns "this seems risky" into a ranked, defensible list the author can act on.

## Self-check before shipping
- [ ] Each objection names a concrete scenario (failure mode + effect + cause)
- [ ] At least three categories of risk covered
- [ ] Objections ranked by RPN (severity × occurrence × detection), not recency
- [ ] Highest-RPN modes have a mitigation or detection point
- [ ] Reversibility of the decision assessed
