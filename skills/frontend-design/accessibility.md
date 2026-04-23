<!--
skills/frontend-design/accessibility.md — Accessibility (WCAG 2.2 / Inclusive Design) — Target **WCAG 2.1 AA** as the minimum for any public-facing product. WCAG 2.2 AA

## Compliance Baseline Target **WCAG 2.1 AA** as the minimum for any public-facing product. WCAG 2.2 AA is the current standard (published October 2023) and req
-->
# Accessibility (WCAG 2.2 / Inclusive Design)

## Compliance Baseline

Target **WCAG 2.1 AA** as the minimum for any public-facing product. WCAG 2.2 AA is the current standard (published October 2023) and required by many regulatory frameworks (EU Web Accessibility Directive, ADA, Section 508).

## Semantic HTML First

Use the right element before reaching for ARIA:

```html
<!-- Avoid: div soup -->
<div class="btn" onclick="submit()">Submit</div>

<!-- Correct: semantic button -->
<button type="submit">Submit</button>
```

ARIA augments semantics it can't add natively; it cannot fix broken semantics.

## ARIA Rules

1. If a native HTML element provides the required semantics, use it — do not add ARIA to a `<div>` when `<button>` exists.
2. Do not change native semantics: `<h2 role="button">` is invalid.
3. All interactive ARIA widgets must be keyboard-operable.
4. Do not hide focusable elements with `aria-hidden="true"`.
5. Every interactive element must have an accessible name.

Common patterns:

```html
<!-- Label associated via for/id -->
<label for="email">Email</label>
<input id="email" type="email" />

<!-- Icon button with visually hidden label -->
<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>

<!-- Live region for async updates -->
<div aria-live="polite" aria-atomic="true" id="status"></div>
```

## Keyboard Navigation

Every interactive element must be reachable and operable by keyboard:

| Key | Expected behavior |
|---|---|
| `Tab` / `Shift+Tab` | Move focus forward / backward |
| `Enter` | Activate links and buttons |
| `Space` | Activate buttons, toggle checkboxes |
| `Arrow keys` | Navigate within composite widgets (menus, tabs, sliders) |
| `Escape` | Close modals, dismiss menus |

Focus trap in modals:

```ts
// Lock focus inside the modal when open
function trapFocus(modal: HTMLElement) {
  const focusable = modal.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}
```

## Color & Contrast

| Text size | Minimum contrast (AA) | Enhanced (AAA) |
|---|---|---|
| Normal text (< 18pt / 14pt bold) | 4.5:1 | 7:1 |
| Large text (≥ 18pt / 14pt bold) | 3:1 | 4.5:1 |
| UI components / graphical objects | 3:1 | — |

Tools: Figma Contrast plugin, axe DevTools, APCA calculator for sophisticated use cases.

Do not convey information by color alone — add shape, pattern, or text.

## Motion

Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

In JS animations (GSAP, Framer Motion):

```ts
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!prefersReduced) gsap.to(el, { y: -20, duration: 0.3 });
```

## Images & Media

- Decorative images: `alt=""`
- Informative images: concise alt text describing the content, not "image of"
- Complex images (charts, diagrams): short alt + long description via `aria-describedby` or adjacent text
- Video: captions for dialogue/audio content; audio description for visual-only information
- Auto-playing media: provide pause control; do not autoplay with sound

## Forms

```html
<fieldset>
  <legend>Shipping address</legend>
  <label for="street">Street <span aria-hidden="true">*</span></label>
  <input id="street" name="street" required aria-required="true"
         aria-describedby="street-error" />
  <span id="street-error" role="alert"></span>
</fieldset>
```

- Group related fields in `<fieldset>` with `<legend>`
- Error messages: use `role="alert"` or `aria-live="assertive"` so screen readers announce them
- Required fields: `required` + `aria-required="true"`; indicate requirement visually and in text

## Testing Checklist

- [ ] Run `axe` or `Lighthouse Accessibility` — fix all violations
- [ ] Navigate entire flow with keyboard only
- [ ] Test with VoiceOver (macOS/iOS) or NVDA/JAWS (Windows)
- [ ] Verify color contrast meets 4.5:1 for body text
- [ ] Test with browser zoom at 200% — no horizontal scroll, no content loss
- [ ] Test with `prefers-reduced-motion: reduce` enabled
- [ ] All form errors are announced by screen reader

## Cognitive Load

- Plain language: grade 8 reading level or below for public-facing copy
- Consistent navigation: same elements in same place across pages
- Timeouts: warn before session expiry; allow extension
- Error recovery: clear error messages with actionable fix instructions
- No flashing content: nothing flashing more than 3 times/second (seizure risk)
