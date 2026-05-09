<!--
skills/roles/designer.accessibility.md — Anti-pattern guidance for the Designer.accessibility (accessibility) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the designer.accessibility (accessibility) domain and counter-moves to avoid them.
Applies to: cx-accessibility.
-->
---
role: designer.accessibility
applies_to: [cx-accessibility]
inherits: designer
version: 1
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

## Self-check before shipping
- [ ] Keyboard-only path tested for every interactive element
- [ ] Screen-reader output verified
- [ ] Semantic HTML first; ARIA only where needed
- [ ] Reduced-motion path exists and is tested
