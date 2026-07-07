---
name: roles-qa-web-ui
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the QA — Web UI role. Use when reviewing or generating work by cx-qa, cx-test-automation, or when an agent is acting in the QA — Web UI role.
inputs: [test-suite, ui]
artifactType: guidance
role: qa.web-ui
applies_to:
  - cx-qa
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

## Self-check before shipping
- [ ] Critical flows include loading, empty, error, and responsive states
- [ ] Keyboard and accessible-name checks are included
- [ ] Selectors are stable and waits are deterministic
- [ ] Visual regressions cover states that users actually encounter
