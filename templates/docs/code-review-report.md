# Code Review Report: {pr-title-or-bd-id}

- **Date**: {YYYY-MM-DD}
- **Reviewer**: reviewer (or named human)
- **Scope**: {files / commits / PR / bd-id}
- **Verdict**: APPROVED | CHANGES_REQUESTED | BLOCKED
- **Status**: draft | final

<!--
A review is not approval theater. Every finding cites file:line from the diff and a concrete
failure scenario; severity is the impact, not the surface. Happy-path checks are not review.
-->

## Summary
<!-- 2–4 sentences: what was reviewed, the top-level verdict, what most matters. Plain language. If there are no findings, say so explicitly. -->

## Findings

| Severity | File:Line | Issue | Recommended Fix |
|---|---|---|---|
| critical / high / medium / low / nit | `path/to/file.ext:NNN` | {what's wrong, with the failure mode it enables} | {smallest safe change, or "discuss"} |

<!--
Severity contract:
  - critical: shipping this regresses correctness, security, or data integrity. Block.
  - high: likely to cause defects in production within weeks. Fix before merge.
  - medium: real risk under specific conditions. Fix before merge, or open a tracked follow-up.
  - low: code-quality / maintainability cost. Optional.
  - nit: cosmetic; reviewer preference. Always optional.
-->

## Conditions the author did not test for
<!-- The point of review: name the inputs, states, and edge cases the diff doesn't account for. One bullet each, with file:line where the gap lives. -->

## Required changes
<!-- The minimum delta before this can merge. Empty if APPROVED. -->

## Verification
<!-- How a reviewer (or CI) would confirm the changes land safely. Reference the test name, the trace id, or the command that proves it. -->

## Handoff
<!-- Where this report goes next. Bare bd-label form so it works across hosts:
  - findings to address → `next:engineer`
  - security concern → `next:security`
  - design / contract concern → `next:architect`
-->
