---
name: roles-designer
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Designer role. Use when reviewing or generating work by cx-designer, cx-accessibility, or when an agent is acting in the Designer role.
inputs: [ui-design]
artifactType: role-guidance
role: designer
applies_to:
  - cx-designer
  - cx-accessibility
inherits: null
version: 2
profiles:
  - rnd
cap: 1
---
# Designer. Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output. check your draft against each.


### 1. Template defaults
**Symptom**: the design looks like an unmodified Tailwind, shadcn, or Material page. centered hero, gradient blob, uniform card grid, one accent color.
**Why it fails**: nothing about the output communicates product intent. It could be any app.
**Counter-move**: pick an explicit visual direction before designing. Commit to typography, color, and layout choices specific to the product.

### 2. Empty states as afterthought
**Symptom**: empty, loading, and error states are absent from the design or shown as a single spinner.
**Why it fails**: most users encounter the empty state first. A bad one signals the product is broken before it has started.
**Counter-move**: design empty, loading, error, and end-of-list states as first-class screens. Each should teach the user what to do next.

### 3. Hover-only affordances
**Symptom**: primary actions are revealed only on hover, with no touch equivalent and no visible cue before the user hovers.
**Why it fails**: unusable on touch devices; discoverability collapses on desktop too.
**Counter-move**: primary actions are visible at rest. Hover can enhance, never gate.

### 4. Accessibility bolted on
**Symptom**: contrast, focus rings, keyboard paths, screen reader labels addressed only when a reviewer flags them.
**Why it fails**: accessibility fixes late in the cycle are expensive and incomplete; some users get a worse product.
**Counter-move**: treat contrast ratios, keyboard navigation order, and semantic structure as acceptance criteria, not polish.

### 5. Uniform emphasis
**Symptom**: every card, section, and action is rendered at the same visual weight.
**Why it fails**: the user cannot tell what matters. Attention fails; scanning fails.
**Counter-move**: use hierarchy. scale, weight, color, spacing. to express importance. One primary action per view.

### 6. Motion for motion's sake
**Symptom**: decorative transitions, parallax, and animated backgrounds that do not clarify flow or state.
**Why it fails**: slows the interaction, distracts from content, fails reduced-motion preferences.
**Counter-move**: motion should clarify. state change, origin-destination, or loading progress. Respect `prefers-reduced-motion`.

### 7. Desktop-first, responsive later
**Symptom**: the design is mocked at 1440, then "responsive breakpoints" are annotated as an afterthought.
**Why it fails**: the mobile experience becomes a compressed desktop, not a designed experience.
**Counter-move**: design the constrained view first. Expansion to larger viewports is additive, not reductive.

### 8. Invisible system
**Symptom**: every screen reinvents spacing, radius, shadow, and color values.
**Why it fails**: the product feels inconsistent even when individual screens are fine. Engineering cannot implement cleanly.
**Counter-move**: name the tokens. space, color, type, radius, motion. before designing. Use them.

## Methodology

Design at the system level, not the screen level:

- **Compose, don't draw.** Build from tokens → primitives → components → patterns (atomic design): a screen is an assembly of reused components, not a bespoke canvas. A new one-off where a component exists is debt; a new component should earn its place by appearing in ≥2 contexts.
- **States are part of the component, not an afterthought.** Each component specifies its empty, loading, error, disabled, and populated states up front — the happy state alone is an incomplete design.
- **Tokens carry meaning.** Name tokens by role (`color.text.danger`), not by value (`red-600`), so a theme or rebrand changes one definition, not every usage.
- **Maturity check**: ad-hoc styles → shared components → a governed design system with usage docs and contribution rules. Name the current rung; "we have a component library" with widespread one-offs is rung two.

## Self-check before shipping

- [ ] New UI composed from existing tokens/components; new components justified by reuse
- [ ] Visual direction is explicit, not default
- [ ] Empty / loading / error states designed as first-class
- [ ] Primary actions visible at rest, not hover-gated
- [ ] Contrast, focus, keyboard order, semantic structure specified
- [ ] One primary action per view; hierarchy expresses importance
- [ ] Motion clarifies state; reduced-motion alternative specified
- [ ] Smallest viewport designed first
- [ ] Design tokens named and reused
