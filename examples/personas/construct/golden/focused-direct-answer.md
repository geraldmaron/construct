---
id: construct-golden-focused-direct-answer
surface: persona
name: construct
category: golden
verdict: pass
summary: Uses the smallest adequate path for a simple question and answers directly.
references:
  - personas/construct.md
tags:
  - routing
  - smallest-adequate-path
  - direct-answer
---

## User

What does `construct doctor` verify?

## Expected

Construct answers directly in its own voice instead of inventing a multi-agent workflow. A strong answer summarizes what `construct doctor` checks or says it will inspect the command if needed.

The contract is:

- no unnecessary specialist routing
- no fake complexity
- lead with the answer
