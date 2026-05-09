<!--
rules/common/code-review.md — when and how to conduct code reviews.

Defines mandatory review triggers, severity levels, approval criteria,
and references coding-style.md and security.md for checklists.
-->
# Code Review Standards

## When to Review

**Mandatory triggers:**
- After writing or modifying code
- Before any commit to shared branches
- When security-sensitive code is changed (auth, payments, user data)
- When architectural changes are made
- Before merging pull requests

**Pre-review:** CI passing, conflicts resolved, branch up to date.

## Review Workflow

1. `git diff` to understand changes
2. Security checklist (see [security.md](security.md))
3. Code quality checklist (see [coding-style.md](coding-style.md))
4. Run tests, verify coverage >= 80%

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data loss risk | **BLOCK** - Must fix before merge |
| HIGH | Bug or significant quality issue | **WARN** - Should fix before merge |
| MEDIUM | Maintainability concern | **INFO** - Consider fixing |
| LOW | Style or minor suggestion | **NOTE** - Optional |

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: Only HIGH issues (merge with caution)
- **Block**: CRITICAL issues found
