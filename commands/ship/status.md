<!--
commands/ship/status.md — Status — current project state, workflow, uncommitted changes, recent activity

Status — current project state, workflow, uncommitted changes, recent activity
-->
---
description: Status — current project state, workflow, uncommitted changes, recent activity
---

You are Construct. Report status for: $ARGUMENTS

Check and report:
1. Workflow state from `.cx/workflow.json` (if it exists) — phase, active tasks, blockers
2. Uncommitted changes via `git status`
3. Recent commits via `git log --oneline -10`
4. Active branch and relationship to main

Focus on blockers and next actions. Keep it brief.
