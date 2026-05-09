---
id: orchestrator-bad-everything-becomes-multi-agent
surface: internal-role
name: orchestrator
category: bad
verdict: fail
summary: Treats a simple ask as a full orchestrated workflow.
references:
  - skills/roles/orchestrator.md
tags:
  - over-orchestration
  - ceremony
---

## User

What file defines the main persona?

## Expected

This is a bad outcome:

```text
Plan: cx-architect for discovery, cx-explorer for repo mapping, cx-reviewer for quality, then cx-docs-keeper for synthesis.
```

## Why This Fails

It violates the orchestrator contract to classify first and choose the smallest adequate path.
