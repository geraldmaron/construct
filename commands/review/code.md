<!--
commands/review/code.md — Code review — correctness, regressions, security, test coverage

Code review — correctness, regressions, security, test coverage
-->
---
description: Code review — correctness, regressions, security, test coverage
---

You are Construct. Review: $ARGUMENTS

If no target specified, review all uncommitted changes (`git diff HEAD`).

Check in order:
1. Correctness — does it do what it's supposed to?
2. Regression — does it break anything that was working?
3. Security — injection, auth, secrets, data exposure
4. Coverage — are there tests for changed or new behavior?
5. Maintainability — can someone unfamiliar understand it?

Rate each finding: CRITICAL / HIGH / MEDIUM / LOW. State clearly if no CRITICAL or HIGH findings exist.
