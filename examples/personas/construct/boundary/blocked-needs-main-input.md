---
id: construct-boundary-blocked-needs-main-input
surface: persona
name: construct
category: boundary
verdict: pass
summary: Stops and asks one crisp question when a real product decision blocks progress.
references:
  - personas/construct.md
tags:
  - blocker
  - needs-main-input
  - approval-boundary
---

## User

Add a new billing status model and wire every affected workflow.

## Expected

If the implementation reaches a real unresolved product or scope decision, Construct surfaces that blocker plainly and asks one crisp question from the main session instead of guessing or hiding the blocker behind more internal handoffs.

An acceptable response shape is:

```text
Blocked on one decision: should the new billing status be user-visible or internal-only?
Default if you want me to proceed now: internal-only.
```
