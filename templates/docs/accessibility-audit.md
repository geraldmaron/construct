# Accessibility Audit: {scope-title}

- **Date**: {YYYY-MM-DD}
- **Auditor**: cx-accessibility (or named human)
- **Scope**: {pages / flows / components / PR}
- **Baseline**: WCAG 2.1 AA (unless otherwise specified)
- **Assistive technology used**: {VoiceOver / NVDA / JAWS / TalkBack / Switch Control / Voice Control / keyboard-only}
- **Verdict**: ACCESSIBLE | ISSUES_FOUND | BLOCKED
- **Status**: draft | final

<!--
Accessibility is measured by using the product, not reading the spec. Every finding cites a
WCAG criterion AND a concrete repro step (keyboard sequence, screen-reader output,
contrast measurement). A claim about assistive-tech behavior you didn't actually exercise
is `unverified` — not a finding.
-->

## Flows tested
<!-- The user flows actually walked through, end-to-end, with the assistive tech named above. A flow that wasn't walked isn't "passed"; it's "not tested." -->

## Findings

| WCAG Criterion | Severity | Element / Location | Repro Steps | Recommended Fix |
|---|---|---|---|---|
| {1.4.3 Contrast, 2.1.1 Keyboard, 4.1.2 Name/Role/Value, ...} | critical / high / medium / low | `{selector or path:line}` | {keystroke sequence + observed result} | {smallest change that restores compliance} |

## High-impact areas

- [ ] **Forms**: labels, error association, required-field signaling, autocomplete, focus management on validation
- [ ] **Images and media**: alt text correctness, captions, transcripts, decorative-vs-informative classification
- [ ] **Navigation**: keyboard order, skip links, landmarks, focus traps in modals
- [ ] **Motion and animation**: prefers-reduced-motion honored, no flashing >3 Hz, no purely-motion conveyors of meaning
- [ ] **Dynamic content**: live regions, status messages, async update announcements
- [ ] **Color and contrast**: text contrast meets AA, meaning not carried by color alone
- [ ] **Keyboard navigation**: every interactive element reachable and operable; no keyboard traps
- [ ] **Screen reader**: every interactive element exposes a name, role, and value; relationships announced

<!-- Tick what was actually exercised. An unticked box is "not audited," not "passed." -->

## Contrast measurements
<!-- Where contrast was checked, the measured ratio, the threshold, and pass / fail. Include the tool used (browser devtools, axe, manual measurement). -->

## Keyboard navigation
<!-- Sequence walked, traps found, focus-visible state. A keyboard audit that doesn't report focus indicators is incomplete. -->

## Screen reader behavior
<!-- For each non-trivial element: what was announced vs. what should have been. Quote the verbatim AT output where possible. -->

## Out of scope
<!-- Flows or surfaces not exercised. Future audits will need to cover them. -->

## Handoff

- design fixes → `next:cx-designer`
- code fixes → `next:cx-engineer`
- review of remediation → `next:cx-reviewer`
