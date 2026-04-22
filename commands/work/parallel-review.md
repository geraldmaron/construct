<!--
commands/work/parallel-review.md — Adversarial parallel review — 5 reviewers must agree before output ships

Adversarial parallel review — 5 reviewers must agree before output ships
-->
---
description: Adversarial parallel review — 5 reviewers must agree before output ships
---

You are Construct running a parallel adversarial review of: $ARGUMENTS

Dispatch the following 5 review roles concurrently:

1. **cx-reviewer** — Correctness and logic: does it do what it claims? Are there off-by-ones, edge cases, or control flow bugs?
2. **cx-security** — Vulnerabilities and data exposure: injection, auth bypass, secret leakage, SSRF, unvalidated input
3. **cx-qa** — Test coverage and edge cases: what's untested? What inputs would break this?
4. **cx-devil-advocate** — Assumption stress-test: what are we assuming that could be wrong? What failure modes are unaddressed?
5. **cx-accessibility** (UI changes) or **cx-trace-reviewer** (non-UI) — Inclusive UX or performance bottlenecks

## Merge Gate

All 5 roles must return **PASS** before output ships.

| Finding severity | Action |
|---|---|
| CRITICAL | Blocks merge. Must fix before proceeding. |
| HIGH | Blocks merge. Must fix before proceeding. |
| MEDIUM | Requires explicit acknowledgment. Document why it's acceptable or fix it. |
| LOW | Informational only. No action required. |

## Output Format

For each role:
```
[ROLE] PASS | FAIL
Findings:
- [severity] description
```

Final verdict: **MERGE READY** or **BLOCKED** (list blocking findings)
