<!--
skills/frontend-design/ux-principles.md — UX Principles — Use this skill when designing user flows, evaluating usability, or planning info

Use this skill when designing user flows, evaluating usability, or planning information architecture. ## Core Heuristics
-->
# UX Principles

Use this skill when designing user flows, evaluating usability, or planning information architecture.

## Core Heuristics

### Visibility of System Status
- Users should always know what is happening
- Loading states, progress indicators, success/error feedback
- Show the current state of interactive elements (selected, disabled, active)

### Match Between System and Real World
- Use language and concepts familiar to the user
- Follow real-world conventions for order and grouping
- Icons and metaphors should be universally understood or labeled

### User Control and Freedom
- Undo and redo for destructive actions
- Clear exit points from flows and modals
- Back navigation that preserves state
- Confirmation for irreversible actions; skip confirmation for reversible ones

### Consistency and Standards
- Same action, same result, every time
- Follow platform conventions (native app vs web vs mobile)
- Internal consistency: identical patterns across your own product

### Error Prevention
- Constraints: disable invalid actions, limit input ranges
- Defaults: prefill with safe, common values
- Confirmation: warn before destructive actions
- Inline validation: immediate feedback on input errors

### Recognition Over Recall
- Visible options and actions; do not require memorization
- Recently used items, search suggestions, autocomplete
- Breadcrumbs and navigation landmarks

### Flexibility and Efficiency
- Keyboard shortcuts for power users
- Customizable workflows where users have varying needs
- Progressive disclosure: simple by default, advanced on demand

### Aesthetic and Minimalist Design
- Remove elements that do not serve the user's task
- Information hierarchy: most important content first
- White space directs attention; clutter diffuses it

### Help Users Recognize and Recover from Errors
- Error messages in plain language, not codes
- Identify what went wrong and suggest next steps
- Preserve user input after errors; do not clear the form

### Help and Documentation
- Contextual help at the point of need
- Searchable documentation
- Onboarding for first-time users; dismissable for returning users

## Information Architecture

### Organization
- Group related items; separate unrelated items
- Use familiar categories and labels
- Card sorting (open and closed) to validate groupings
- Tree testing to validate navigation structure

### Navigation
- Primary navigation: 5-7 top-level items maximum
- Breadcrumbs for hierarchical content
- Search for content-heavy applications
- Consistent navigation across all pages

### Labeling
- Action labels describe the outcome: "Save Changes" not "Submit"
- Navigation labels match page titles
- Avoid jargon; test labels with real users

## User Flows

### Flow Design
- Map the happy path first, then error and edge cases
- Minimize steps to complete the primary task
- Show progress in multi-step flows
- Allow saving and resuming long flows
- Exit points should not lose work

### Forms
- One column layout for most forms
- Group related fields with visual separation
- Label above input for scannability
- Required vs optional clearly marked
- Inline validation on blur, not on every keystroke
- Smart defaults reduce input effort

## Responsive Design

- Content-first: design for the content, then adapt to viewports
- Mobile-first: start with the smallest viewport, enhance upward
- Touch targets: minimum 44x44px on mobile
- Thumb zone: primary actions within easy reach on mobile
- Test at real breakpoints: 320, 375, 768, 1024, 1440

## Accessibility as UX

- Keyboard navigation for all interactive elements
- Focus indicators that are visible and intentional
- Color is never the only way to convey information
- Text alternatives for non-text content
- Reduced motion mode respected
- Screen reader testing with VoiceOver and NVDA

## Research Methods

| Method | When |
|---|---|
| User interviews | Understanding needs and context |
| Usability testing | Validating a design with real users |
| A/B testing | Choosing between design variants with data |
| Analytics | Understanding actual usage patterns |
| Card sorting | Organizing content and navigation |
| Heuristic evaluation | Expert review against known principles |
