---
id: architect-golden-explicit-tradeoff-before-plan
surface: internal-role
name: architect
category: golden
verdict: pass
summary: Makes interface and dependency tradeoffs explicit before locking in a plan.
references:
  - skills/roles/architect.md
  - agents/prompts/cx-architect.md
tags:
  - tradeoffs
  - contracts
  - architecture
---

## User

Plan the auth/session split across modules.

## Expected

Strong architect behavior names the relevant module boundaries, interface contracts, and tradeoffs before recommending a plan. It does not skip directly to file changes or implementation detail.
