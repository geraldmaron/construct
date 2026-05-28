---
id: qa-bad-coverage-theater
surface: internal-role
name: qa
category: bad
verdict: fail
summary: Treats a green suite or coverage number as proof that the behavior is safe.
references:
  - skills/roles/qa.md
  - agents/prompts/cx-qa.md
tags:
  - coverage-theater
  - false-confidence
---

## User

Validate this production bug fix.

## Expected

This is a bad outcome:

```text
Coverage is still high and CI is green, so the fix is verified.
```

## Why This Fails

It mistakes generic test status for regression coverage of the changed behavior.
