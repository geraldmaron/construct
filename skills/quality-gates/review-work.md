---
name: quality-gates-review-work
description: Use this methodology when a change needs rigorous pre-merge validation. Five independent review roles run concurrently. All must pass.
inputs: [change-or-diff, acceptance-criteria]
artifactType: review-report
---
# Parallel Adversarial Review

Use this methodology when a change needs rigorous pre-merge validation. Five independent review roles run concurrently. All must pass.

## When to use

- Changes to auth, payments, or security-sensitive paths
- New public APIs or external integrations
- Architecture changes touching multiple modules
- Any change requested via `/work:parallel-review`
- When the `reviewer` Worker Profile determines a change warrants deeper scrutiny

## The 5 Review Roles

### 1. Correctness (reviewer)
- Does the code do what it claims?
- Are there logic bugs, off-by-ones, or incorrect control flow?
- Does it handle nil/null/empty/zero correctly?
- Are error paths exercised?

### 2. Security (security)
- Injection risks (SQL, command, LDAP, XPath)
- Authentication and authorization gaps
- Sensitive data in logs, responses, or error messages
- Unvalidated external input
- Secret exposure (hardcoded keys, environment leakage)
- SSRF, path traversal, CSRF

### 3. Test Coverage (qa)
- What behaviors have no test coverage?
- Which edge cases are untested?
- Are tests verifying behavior or just implementation?
- Would these tests catch a regression if the implementation changed?

### 4. Assumptions (architect; load `perspectives/devil-advocate` on reviewer for FMEA / plan-challenge)
- What are we assuming that could be wrong?
- What happens at scale or under load?
- What external dependencies could fail?
- What invariants does this break?
- What's the blast radius if this is wrong?

(Retired `cx-devil-advocate` folded into `reviewer`'s plan-challenge mode per ADR-0065; `architect` covers ADR/RFC-level assumption scrutiny at the boundary.)

### 5. Quality (designer for UI; debugger for non-UI)

**UI changes: designer** (retired `cx-accessibility` folded here):
- Keyboard navigation
- Screen reader compatibility
- Color contrast and focus visibility
- Reduced motion support

**Non-UI changes: debugger** (retired `cx-trace-reviewer` performance/trace duties):
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

## Artifact / docs changes

When the change includes typed artifacts (PRD, ADR, research, compliance), also verify:

- Load-bearing claims cite re-verifiable sources or are marked `unknown` / `[unverified]` (`rules/common/no-fabrication.md`)
- Phased PRDs carry Phase **Why?** and Phase→FR→AC nesting (`skills/docs/artifact-authorship.md`)
- Triggered cross-persona reviews (privacy, legal, a11y, ops) are present or owned as open questions
- **Human voice bar** (`rules/common/human-voice.md`): prefer contractions in prose; flag spaced em-dash theater (` — `) and Unicode em dashes; flag LLM tells (delve, landscape outside required titles, robust/leverage as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons). Sterile corporate voice that reads like a model template is a Medium finding unless an exception applies (AC precision, legal shall/must, quoted statute, exact section titles).
