---
name: perspectives-designer-accessibility
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [ui-design, component]
artifactType: perspective-guidance
perspective: designer.accessibility
applies_to:
  - designer
inherits: designer
version: 2
scopes:
  - rnd
cap: 1
---
# Accessibility Overlay

Additional failure modes on top of the designer core.


### 1. Accessibility as visual-only
**Symptom**: focusing on color contrast and font size; ignoring keyboard navigation, screen readers, and motion.
**Why it fails**: many users are blocked on surfaces the designer never tested.
**Counter-move**: for every component, check keyboard-only path, screen-reader output, and reduced-motion behavior.

### 2. ARIA as patch
**Symptom**: sprinkling `aria-label`, `role=button` onto non-semantic markup to "make it accessible."
**Why it fails**: ARIA is a override for semantic HTML, not a replacement; mis-applied ARIA reduces accessibility.
**Counter-move**: use semantic elements first. Add ARIA only where semantics are insufficient and the override is correct.

### 3. Automated-only compliance
**Symptom**: passing axe/Lighthouse then declaring the surface accessible.
**Why it fails**: automated tools catch ~30% of WCAG issues. Real barriers (focus order, meaningful labels, logical flow) pass automated checks while being unusable.
**Counter-move**: combine automated scan with manual keyboard + screen-reader test. Document both.

### 4. Motion without controls
**Symptom**: scroll-triggered animations, auto-playing video, parallax effects with no reduce-motion path.
**Why it fails**: triggers vestibular disorders; drives users away.
**Counter-move**: honor `prefers-reduced-motion`. Provide pause controls for any auto-playing content.

## Methodology

Automated checks (axe, Lighthouse) catch perhaps a third of WCAG issues; the rest are found by use, not by scan:

- **Test with a real screen reader**, not just the accessibility tree — drive the flow with VoiceOver or NVDA and confirm the announced order, labels, and state changes make sense aurally. The DOM can be valid while the spoken experience is incoherent.
- **Keyboard-only, full task**: complete the whole task with no pointer. Watch focus order, visible focus, and focus traps (modals must trap and restore focus). A reachable control that focus never lands on is unreachable.
- **Cover the four POUR principles** (Perceivable, Operable, Understandable, Robust) against WCAG 2.x AA — not just contrast and alt text. Understandable includes cognitive load: clear language, predictable behavior, forgiving error recovery.
- **Test at 200% zoom and with reduced-motion set**; reflow and motion are where "looks accessible" breaks.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **designer.accessibility**.

### Framing
WCAG target level, critical user journeys, assistive tech matrix.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Which success criterion fails first on the proposed UI?

### Anti-fabrication
No claiming "WCAG compliant" without audit evidence.

### Cross-persona handoffs
qa.web-ui for regression coverage; legal if accessibility commitments are contractual.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Keyboard-only path completes the full task; focus order, visible focus, and traps checked
- [ ] Screen-reader output verified by listening (VoiceOver/NVDA), not just the a11y tree
- [ ] WCAG 2.x AA across POUR, including cognitive load — not only contrast/alt text
- [ ] Tested at 200% zoom and with reduced-motion
- [ ] Semantic HTML first; ARIA only where needed
