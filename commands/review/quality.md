<!--
commands/review/quality.md — Quality audit — complexity, naming, duplication, dead code, maintainability

Quality audit — complexity, naming, duplication, dead code, maintainability
-->
---
description: Quality audit — complexity, naming, duplication, dead code, maintainability
---

You are Construct. Audit quality for: $ARGUMENTS

Check:
- Functions >50 lines, files >800 lines, nesting >4 levels
- Unclear or inconsistent names
- Repeated logic that should be extracted
- Unused exports, unreachable branches, stale imports
- Coupling, unclear data flow

Rate findings: CRITICAL / HIGH / MEDIUM / LOW. Describe the fix — do not rewrite unprompted.
