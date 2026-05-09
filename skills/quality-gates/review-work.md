<!--
skills/quality-gates/review-work.md — Parallel Adversarial Review — Use this methodology when a change needs rigorous pre-merge validation. Five ind

Use this methodology when a change needs rigorous pre-merge validation. Five independent review roles run concurrently. All must pass. ## When to use
-->
# Parallel Adversarial Review

Use this methodology when a change needs rigorous pre-merge validation. Five independent review roles run concurrently. All must pass.

## When to use

- Changes to auth, payments, or security-sensitive paths
- New public APIs or external integrations
- Architecture changes touching multiple modules
- Any change requested via `/work:parallel-review`
- When the `cx-reviewer` determines a change warrants deeper scrutiny

## The 5 Review Roles

### 1. Correctness (cx-reviewer)
- Does the code do what it claims?
- Are there logic bugs, off-by-ones, or incorrect control flow?
- Does it handle nil/null/empty/zero correctly?
- Are error paths exercised?

### 2. Security (cx-security)
- Injection risks (SQL, command, LDAP, XPath)
- Authentication and authorization gaps
- Sensitive data in logs, responses, or error messages
- Unvalidated external input
- Secret exposure (hardcoded keys, environment leakage)
- SSRF, path traversal, CSRF

### 3. Test Coverage (cx-qa)
- What behaviors have no test coverage?
- Which edge cases are untested?
- Are tests verifying behavior or just implementation?
- Would these tests catch a regression if the implementation changed?

### 4. Assumptions (cx-devil-advocate)
- What are we assuming that could be wrong?
- What happens at scale or under load?
- What external dependencies could fail?
- What invariants does this break?
- What's the blast radius if this is wrong?

### 5. Quality (cx-accessibility for UI; cx-trace-reviewer for non-UI)

**UI changes — cx-accessibility:**
- Keyboard navigation
- Screen reader compatibility
- Color contrast and focus visibility
- Reduced motion support

**Non-UI changes — cx-trace-reviewer:**
- N+1 queries or unbounded loops
- Memory or connection leaks
- Missing caching for expensive operations
- Latency impact on hot paths

## Merge Gate Rules

| Severity | Action |
|---|---|
| CRITICAL | Block. Fix before proceeding. |
| HIGH | Block. Fix before proceeding. |
| MEDIUM | Acknowledge. Document why it's acceptable or fix it. |
| LOW | Informational. No action required. |

## Output Format

```
[CORRECTNESS] PASS | FAIL
- [HIGH] description of finding

[SECURITY] PASS | FAIL
- [CRITICAL] description of finding

[COVERAGE] PASS | FAIL
- [MEDIUM] description of finding

[ASSUMPTIONS] PASS | FAIL
- [LOW] description of finding

[ACCESSIBILITY|PERFORMANCE] PASS | FAIL
- [MEDIUM] description of finding

VERDICT: MERGE READY | BLOCKED
Blocking findings: (list if BLOCKED)
```
