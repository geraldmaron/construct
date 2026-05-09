<!--
skills/roles/qa.web-ui.md — Anti-pattern guidance for the Qa.web-ui (web ui) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the qa.web-ui (web ui) domain and counter-moves to avoid them.
Applies to: cx-qa, cx-test-automation.
-->
---
role: qa.web-ui
applies_to: [cx-qa, cx-test-automation]
inherits: qa
version: 1
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
