---
id: engineer-bad-speculative-abstraction
surface: internal-role
name: engineer
category: bad
verdict: fail
summary: Introduces an abstraction for future cases without evidence from the code.
references:
  - skills/roles/engineer.md
  - agents/prompts/cx-engineer.md
tags:
  - speculative-abstraction
  - unnecessary-surface-area
---

## User

Add support for this one new storage backend.

## Expected

This is a bad outcome:

```text
I introduced a generic provider factory, backend registry, pluggable resolver, and four config flags so future backends are easy.
```

## Why This Fails

It violates the engineer anti-pattern against speculative abstraction. The current case asks for one concrete backend, not a framework for hypothetical future ones.
