<!--
skills/frontend-design/ui-aesthetics.md — UI Aesthetics — Use this skill when making visual design decisions: color, typography, layout, s

Use this skill when making visual design decisions: color, typography, layout, spacing, and visual hierarchy. ## Color
-->
# UI Aesthetics

Use this skill when making visual design decisions: color, typography, layout, spacing, and visual hierarchy.

## Color

### System Design
- Define a palette with semantic roles: primary, secondary, surface, text, error, warning, success
- Use perceptually uniform color spaces (OKLCH, OKLAB) for consistent contrast and harmony
- 60-30-10 rule: dominant surface, secondary accent, tertiary highlight
- Ensure WCAG AA contrast ratios: 4.5:1 for normal text, 3:1 for large text

### Application
- Color communicates hierarchy: brightest/most saturated draws attention first
- Limit palette to 3-5 hues; vary lightness and saturation for range
- Use opacity and surface layering to create depth
- Test both light and dark themes if both are supported; do not auto-invert
- Avoid pure black (#000) on white (#fff); reduce contrast slightly for comfort

## Typography

### Selection
- Maximum two typeface families per project
- Pair a serif and sans-serif, or two weights of one family
- Ensure readability at body size (16px minimum for body text)
- License fonts correctly; subset to used glyphs for performance

### Scale
- Use a modular scale (1.25, 1.333, 1.5 ratio) for consistent sizing
- Fluid type with `clamp()`: `font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem)`
- Limit to 5-6 distinct sizes
- Line height: 1.4-1.6 for body, 1.1-1.2 for headings
- Measure (line length): 45-75 characters for body text

### Hierarchy
- Size contrast between heading levels: at least 1.25x step
- Weight contrast: regular body, semibold subheads, bold headlines
- Use case, spacing, and color as secondary hierarchy signals
- Avoid all-caps for more than short labels

## Spacing

### System
- Define a spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (or similar)
- Use consistent spacing tokens throughout
- Larger spacing between unrelated groups; tighter within related items
- White space is a design element, not wasted space

### Rhythm
- Vertical rhythm: consistent baseline grid for text and components
- Horizontal rhythm: align to a column grid (8, 12, or 16 columns)
- Irregular spacing breaks rhythm intentionally for emphasis

## Layout

### Hierarchy
- Visual weight: size, color, contrast, whitespace, and position create hierarchy
- Most important element is largest, highest contrast, or most isolated
- Progressive disclosure: show overview first, detail on demand
- F-pattern or Z-pattern for content scanning

### Grid
- CSS Grid for two-dimensional layouts
- Flexbox for one-dimensional alignment
- Break the grid intentionally for editorial emphasis
- Responsive: define breakpoints by content, not by device

### Composition
- Bento layouts for dashboard-style content
- Asymmetric layouts for editorial content
- Card-based layouts for scannable collections
- Full-bleed sections for immersive moments

## Depth and Surface

- Layer surfaces with elevation: background < card < modal < toast
- Shadows should be soft, directional, and consistent with a single light source
- Blur and transparency for glassmorphic surfaces (use sparingly)
- Border and divider lines: thin (1px), low contrast, used to separate not decorate

## Motion

- Motion clarifies transitions and relationships
- Duration: 150ms for micro-interactions, 300ms for transitions, 500ms+ for choreographed sequences
- Easing: ease-out for entrances, ease-in for exits, ease-in-out for state changes
- Animate compositor-friendly properties: transform, opacity, clip-path
- Respect `prefers-reduced-motion`

## Quality Checklist

- [ ] Clear visual hierarchy: can you identify primary, secondary, and tertiary elements?
- [ ] Consistent spacing rhythm throughout
- [ ] Color palette is cohesive with semantic meaning
- [ ] Typography pairing is intentional and readable
- [ ] Depth and surface use supports hierarchy
- [ ] No orphaned or floating elements without visual anchoring
- [ ] Design looks intentional, not templated
