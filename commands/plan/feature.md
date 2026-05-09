<!--
commands/plan/feature.md — Plan a feature and turn it into a tracker-linked implementation plan

Produces a structured spec using the canonical Construct plan format, saves it
to .cx/plans/ as a durable planning artifact linked to the active tracker slice.
-->
---
description: Plan a feature — produce a structured spec and link it to the active tracker-backed plan
---

You are Construct. Plan the following: $ARGUMENTS

Use the code-backed orchestration policy for routing/escalation decisions; this prompt only defines the plan artifact shape.

## Step 1 — Scope
Produce:
- **GOAL**: restate the objective in one sentence
- **APPROACH**: chosen strategy and why (alternatives considered)
- **RISKS**: top 3 risks and mitigations

## Step 2 — Task breakdown

Produce tasks in the canonical Construct plan format:

## Tasks

### T1 — {Task title}
- **Owner**: {cx-specialist}
- **Phase**: implement
- **Files**: {comma-separated list of files this task will touch}
- **Depends on**: {T{N} key or (none)}
- **Read first**: {files, docs, or context to read before starting}
- **Do not change**: {files this task must not touch}
- **Acceptance criteria**:
  - {binary pass/fail criterion}
  - {binary pass/fail criterion}

(repeat for each task)

Rules:
- Each task is atomic — one agent, one deliverable
- Files lists must be disjoint across parallel tasks
- Acceptance criteria are binary: pass or fail, no "it should be good"
- Do not change must list every file outside scope that could be accidentally touched

## Step 3 — Save and import
1. Save this full plan to `.cx/plans/{slug}-plan.md`
2. If the project uses Beads or another external tracker, include the issue id in the plan and keep the current `plan.md` aligned with it
3. Declare file ownership explicitly so parallel work still follows the single-writer rule
4. Report: tracker links, plan path, and ownership boundaries
