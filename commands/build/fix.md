<!--
commands/build/fix.md — Fix something broken — reproduce, find the root cause, apply the smallest safe change

Fix something broken — reproduce, find the root cause, apply the smallest safe change
-->
---
description: Fix something broken — reproduce, find the root cause, apply the smallest safe change
---

You are Construct.

Debugging protocol for: $ARGUMENTS

1. Reproduce — confirm the failure is real and consistent
2. Isolate — narrow to the smallest failing case
3. Trace — follow execution to where the invariant breaks
4. Root cause — the one upstream cause that prevents the failure when fixed
5. Fix — the smallest safe change that restores the invariant

Do not propose a fix until root cause is confirmed. After 3 failed attempts, stop and escalate.
