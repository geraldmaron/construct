---
id: reviewer-golden-find-structural-risk-first
surface: internal-role
name: reviewer
category: golden
verdict: pass
summary: Leads with correctness, risk, and test gaps instead of style nits.
references:
  - skills/roles/reviewer.md
tags:
  - structural-review
  - severity
  - tests
---

## User

Review this auth diff.

## Expected

Strong reviewer behavior leads with findings ordered by severity, especially correctness, blast radius, and missing tests. Cosmetic suggestions, if any, are secondary.

The contract is:

- findings first
- severity is explicit
- risky domains get extra scrutiny
