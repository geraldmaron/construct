---
name: frontend-design-screen-reader-testing
description: "Use when: a UI needs to be tested with a screen reader and keyboard to verify it is actually operable non-visually, not just compliant on paper."
inputs: [ui-or-component]
artifactType: accessibility-findings
---
# Screen Reader Testing

Use this skill when a UI needs to be verified as operable with a screen reader and keyboard — accessibility measured by use, not by an automated checklist.

Automated scanners catch missing alt text and contrast, but they cannot tell you whether a flow is *usable* non-visually. That requires driving the interface the way a screen-reader user does: keyboard only, listening to what is announced.

## Steps

1. **Pick the flow, not the page.** Test a complete task (sign in, submit a form), because accessibility failures cluster at transitions and dynamic updates.
2. **Keyboard-only first.** Unplug the mouse. Tab through: is every interactive element reachable, in a sensible order, with a visible focus indicator? Can you complete the task? Note any keyboard trap.
3. **Screen reader pass** (VoiceOver/NVDA/Orca). For each control, confirm the announced name, role, and state match what's on screen. A button announced as "button" with no name is a failure.
4. **Dynamic content**: trigger validation errors, loading states, toasts, modals. Confirm they are announced (live regions) and that focus moves correctly — a modal that opens without moving focus is unusable.
5. **Forms**: confirm each field's label is associated, errors are announced and linked to the field, and required state is conveyed non-visually.
6. **Record findings** by severity: blocker (task cannot be completed), serious (completable but confusing), minor.

## Output shape

```
## Flow: <task>
| step | issue | severity | expected |
|---|---|---|---|
```

## Verification bar

- Findings come from actually driving the flow with keyboard + screen reader, not from inspecting markup alone.
- Each finding names the expected announced name/role/state, so the fix is unambiguous.
- Severity reflects task impact, not rule count.
