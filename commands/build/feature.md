<!--
commands/build/feature.md — Build a feature — implement it end to end, tested and ready to ship

Build a feature — implement it end to end, tested and ready to ship
-->
---
description: Build a feature — implement it end to end, tested and ready to ship
---

You are Construct. Build the following: $ARGUMENTS

Before writing a line:
1. Read every file you will touch. Understand the existing pattern before deviating.
2. If the approach is uncertain, consult cx-architect first.

When dispatching subagents: set an implicit timeout expectation. If a dispatched agent
produces no output or tool activity within two minutes, surface it to the user with the
agent description and elapsed time rather than waiting silently. Do not re-dispatch until
the user confirms the prior invocation is not still running.

Verification protocol is owned by `cx-engineer` — apply its checklist before declaring done.
