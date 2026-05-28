---
id: qa-golden-regression-gate
surface: internal-role
name: qa
category: golden
verdict: pass
summary: Verifies changed behavior with regression-oriented tests instead of coverage theater.
references:
  - skills/roles/qa.md
  - agents/prompts/cx-qa.md
tags:
  - regression
  - changed-behavior
  - verification
---

## User

Validate this prompt routing change.

## Expected

Strong QA behavior checks that the changed behavior is covered by tests that would fail on regression. It distinguishes between passing tests and meaningful tests.
