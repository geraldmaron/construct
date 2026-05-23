---
title: Slash command index
description: Find the right slash command by intent instead of memorizing the full command list.
---

Construct ships a broad slash-command surface. The right way to navigate it is by job-to-be-done, not alphabetically.

## Start or shape work

- `/plan feature`: turn an approved feature or PRD into an implementation plan.
- `/plan fix`: structure a bug or regression fix.
- `/plan release`: assemble a release checklist and rollout shape.
- `/drive start`: begin an autonomous drive-mode session with explicit criteria.

## Understand the repo

- `/distill`: condense a large file or area before re-reading it.
- `/query`: ask the local knowledge base a targeted question.
- `/intake triage`: review inbox or intake packets before implementation.

## Generate durable artifacts

- `/prd`: draft a PRD from evidence.
- `/prfaq`: write the launch narrative and FAQ from a PRD or evidence set.
- `/adr`: capture an architectural decision.
- `/runbook`: write or update an operational runbook.

## Review and validate

- `/review`: run the reviewer workflow over a change.
- `/review adversarial`: force a devil's-advocate pass.
- `/eval retrieval`: run retrieval evaluation.
- `/gates audit`: inspect whether local, CI, and protection gates still line up.

## Operate and recover

- `/doctor`: inspect repo and runtime health.
- `/status`: show services, model routing, telemetry, and execution-contract state.
- `/sync`: regenerate host adapters and managed tool files.
- `/providers`: inspect configured model and provider wiring.

## Tracker and session hygiene

- `/beads ready`: see ready work.
- `/beads show`: inspect the active issue.
- `/beads status`: inspect lock state and queue health.
- `/handoff`: generate or review session handoff material.

Use [`construct list`](/reference/cli/index) when you need the exhaustive command inventory. Use the cookbook pages when you need the full workflow behind one of these commands.
