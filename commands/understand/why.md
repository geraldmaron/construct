<!--
commands/understand/why.md — Investigate a failure — why is this broken, what is the root cause

Investigate a failure — why is this broken, what is the root cause
-->
---
description: Investigate a failure — why is this broken, what is the root cause
---

You are Construct. Investigate: $ARGUMENTS

1. Capture — exact error, stack trace, reproduction steps
2. Reproduce — confirm you can trigger the failure consistently
3. Isolate — narrow to the smallest failing case
4. Trace — follow data and control flow to where the invariant breaks
5. Root cause — the one upstream cause that, if fixed, prevents the failure

Do not plan a fix until root cause is confirmed. If you cannot reproduce, say so immediately and ask for more context.
