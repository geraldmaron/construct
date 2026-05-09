<!--
skills/frontend-design/component-patterns.md — Component Patterns — Use this skill when designing component architecture, building design systems, o

Use this skill when designing component architecture, building design systems, or structuring reusable UI. ## Component Hierarchy
-->
# Component Patterns

Use this skill when designing component architecture, building design systems, or structuring reusable UI.

## Component Hierarchy

### Atoms
- Smallest meaningful UI elements: button, input, label, icon, badge
- Self-contained: no dependencies on other components
- Accept props for variants: size, color, disabled state
- Fully accessible with ARIA attributes and keyboard support

### Molecules
- Combinations of atoms: search field (input + button), form group (label + input + error)
- Encapsulate a single interaction pattern
- Manage internal state for the interaction only

### Organisms
- Complex sections composed of molecules: navigation bar, card grid, data table
- May connect to data sources or global state
- Define layout and composition of their children

### Templates and Pages
- Templates define the layout structure without data
- Pages are templates filled with real content and connected to routing

## Composition Patterns

### Compound Components
- Related components share implicit state via context
- Parent owns state; children consume and render
- Gives consumers control over rendering while keeping logic centralized

### Render Props / Slots
- Component provides behavior; consumer provides rendering
- Useful for headless components: dropdown logic without markup opinion
- Keeps ARIA, keyboard, and focus management in the shared layer

### Container / Presentational
- Container: handles data fetching, state management, side effects
- Presentational: receives props, renders UI, stays pure
- Easier to test, reuse, and maintain

### Polymorphic Components
- `as` or `component` prop to render as different HTML elements
- A `Button` that renders as `<a>` for link-style buttons
- Preserves type safety with generics

## Props Design

- Required props: minimum needed for the component to function
- Optional props with sensible defaults
- Boolean props: avoid double negatives (`isDisabled` not `isNotEnabled`)
- Event handlers: `on` prefix (`onClick`, `onChange`)
- Children: use `children` prop or slots for composition
- Avoid prop drilling beyond two levels; use context or composition

## State Ownership

| State Type | Where to Manage |
|---|---|
| UI state (open, focused, hovered) | Component-local |
| Form state (values, validation, dirty) | Form library or parent component |
| Server state (API data, cache) | Data fetching library (TanStack Query, SWR) |
| URL state (filters, pagination, tab) | URL / router |
| Global state (theme, user, preferences) | Context or lightweight store |

- Lift state to the nearest common ancestor that needs it
- Derive values instead of storing computed state
- Single source of truth for each piece of state

## Design System Tokens

- **Color**: semantic names (text-primary, surface-elevated, border-subtle)
- **Typography**: scale steps (text-sm, text-base, text-lg, text-xl)
- **Spacing**: scale steps (space-1 through space-12)
- **Radius**: small, medium, large, full
- **Shadow**: elevation levels (shadow-sm, shadow-md, shadow-lg)
- Implement as CSS custom properties or theme objects
- Document every token with visual examples

## Accessibility Checklist

- [ ] Every interactive element is keyboard accessible
- [ ] Focus order matches visual order
- [ ] Focus indicators are visible
- [ ] ARIA roles, labels, and states are correct
- [ ] Color contrast meets WCAG AA
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Screen reader announces state changes (live regions)

## Testing Components

- Unit test: logic, state transitions, prop handling
- Interaction test: click, type, keyboard navigation
- Visual regression: screenshot comparison at key breakpoints
- Accessibility audit: automated scanning plus manual keyboard test
- Storybook or equivalent for isolated component development and documentation

## Anti-Patterns

- God components that handle fetching, state, rendering, and styling
- Prop drilling through more than two intermediate components
- Tightly coupled components that cannot be used independently
- Rebuilding browser-native behavior (scrolling, focus management) poorly
- CSS leaking between components via global selectors
