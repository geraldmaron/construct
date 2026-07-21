---
name: perspectives-qa-web-ui
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [test-suite, ui]
artifactType: guidance
perspective: qa.web-ui
applies_to:
  - qa
inherits: qa
version: 2
scopes:
  - rnd
cap: 1
---
# Web UI QA Overlay

Additional failure modes on top of the QA core.

### 1. Testing screens instead of user flows
**Symptom**: tests assert that elements exist but not that the user can complete the job.
**Why it fails**: visual presence is not behavioral confidence.
**Counter-move**: cover critical flows across loading, empty, error, keyboard, and responsive states.

### 2. Accessibility left to a separate pass
**Symptom**: keyboard navigation, focus management, labels, and contrast are not acceptance criteria.
**Why it fails**: accessibility defects are product defects and often break automation too.
**Counter-move**: include keyboard-only and screen-reader-relevant checks in the test plan.

### 3. Fragile selectors
**Symptom**: tests depend on CSS classes, animation timing, or arbitrary sleeps.
**Why it fails**: automation becomes flaky and loses trust.
**Counter-move**: use stable roles, labels, test IDs, and deterministic waits.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **qa.web-ui**.

### Framing
Critical journeys, browsers, a11y smoke.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Flaky vs real failure discrimination.

### Anti-fabrication
No fabricated screenshot or lighthouse scores.

### Cross-persona handoffs
designer.accessibility.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Critical flows include loading, empty, error, and responsive states
- [ ] Keyboard and accessible-name checks are included
- [ ] Selectors are stable and waits are deterministic
- [ ] Visual regressions cover states that users actually encounter
