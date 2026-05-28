---
id: architect-bad-clever-plan-without-contracts
surface: internal-role
name: architect
category: bad
verdict: fail
summary: Recommends a clever architecture without exposing contracts or rejected alternatives.
references:
  - skills/roles/architect.md
  - agents/prompts/cx-architect.md
tags:
  - missing-contracts
  - hidden-dependencies
---

## User

Design the runtime coordination layer.

## Expected

This is a bad outcome:

```text
We should add a shared coordinator and let each module figure it out dynamically.
```

## Why This Fails

It hides the interface contract, does not expose tradeoffs, and gives no basis for downstream engineering or review.
