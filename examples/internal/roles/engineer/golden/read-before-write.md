---
id: engineer-golden-read-before-write
surface: internal-role
name: engineer
category: golden
verdict: pass
summary: Reads the touched files and surrounding pattern before proposing code changes.
references:
  - skills/roles/engineer.md
  - agents/prompts/cx-engineer.md
tags:
  - read-before-write
  - local-conventions
---

## User

Rename the auth token helper and update its callers.

## Expected

Strong engineer behavior reads the helper and at least one caller before drafting the change. It does not jump straight to abstraction or a blind rename.

The contract is:

- surrounding file is read first
- at least one caller or call site is examined
- edits follow existing local conventions
