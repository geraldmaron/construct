---
name: docs-init-docs
description: "`init docs`, `create docs structure`, `set up documentation`, `docs scaffold`, `documentation init`. Use when the task matches the trigger conditions described in the body."
inputs: [task-context]
artifactType: docs-scaffold
---
# Skill: init-docs: Initialize Project Documentation Structure

## Trigger keywords
`init docs`, `create docs structure`, `set up documentation`, `docs scaffold`, `documentation init`

## What this skill does

When invoked, gather the user's intent and create a tailored documentation directory structure. The structure serves as both human reference and **required operational project state**: all LLMs working in this project, including Construct, should read these docs to understand purpose, decisions, constraints, and active reality before acting.

---

## Step 1: Gather intent (ask these questions)

Ask the user **all at once** (single message, not one at a time):

1. **What is this project?** A brief description (one sentence is fine)
2. **What doc types will you have?** See the lane table below for options
3. **Who is the audience?** Engineers, external users, both, or internal team only
4. **Tech stack?** (affects whether API reference or RFC sections are needed)
5. **Monorepo or single-service?** Affects directory depth

---

## Step 2: Generate the structure

Based on answers, create the `docs/` directory and appropriate subdirectories. Use this as a base: add or remove sections based on the user's answers.

### Core structure (always include)

```
docs/
├── README.md                  # Required docs contract and navigation index
└── architecture.md            # Canonical architecture and invariants

.construct/
├── context.md                 # Human-readable resumable context
├── context.json               # Machine-readable resumable context
└── workflow.json              # Canonical workflow/task state
```

## Interactive UX (TTY)

When run interactively, `construct init --docs-preset=*` renders a keyboard-driven **full-screen checkbox picker**: all available lanes listed with the default set pre-checked and context-suggested lanes highlighted in the UI. No typing required.

- **↑ / ↓**: move cursor (details shown in a dedicated panel)
- **Space**: toggle lane on/off
- **a**: toggle all on/off
- **Enter**: confirm and scaffold
- Follow-up choices use the same menu pattern instead of free-text answers

The single canonical drop zone for ingestable files is `inbox/` at the project root (ADR-0045 §C); `construct init` scaffolds it with a gitignored `inbox/.staging/` for atomic handoff. The `intake` docs lane (`docs/intake/`) is a separate, optional durable paper-trail lane for intake batch records — it is not a watched drop zone.

When run non-interactively (`--yes` or piped stdin), the lean default set is used unless `--docs=` is supplied. `--docs=lean|product|full` or `--docs=adrs,prds,rfcs` both work.

---

### Available lanes

| Lane         | Directory       | What goes here |
|--------------|-----------------|----------------|
| adrs         | `docs/decisions/adr/`         | Architecture decisions that have already been made |
| briefs       | `docs/briefs/`      | Research, evidence, signals, one-pagers, customer profiles |
| changelogs   | `docs/changelogs/`  | User-facing release notes and version history entries |
| intake       | `docs/intake/`      | Intake batch records that explain what arrived, why it matters, and how it should be ingested |
| memos        | `docs/notes/memos/`       | Decision memos and internal arguments for alignment |
| meetings     | `docs/notes/meetings/`    | Meeting notes, minutes, standups, retros, agendas, and session summaries |
| notes        | `docs/notes/`       | Working notes and lightweight durable context outside formal docs or meetings |
| onboarding   | `docs/onboarding/`  | Runnable setup guides and first-day workflows |
| postmortems  | `docs/postmortems/` | Blameless incident reports with root cause and corrective actions |
| prds         | `templates/docs/prds/`        | Product and capability requirement documents |
| rfcs         | `templates/docs/rfcs/`        | Architecture and implementation proposals needing review |
| runbooks     | `docs/operations/runbooks/`    | Operational procedures, diagnostics, escalation paths |

### Guidance: which lanes to suggest

| Signal in the project | Suggest |
|-----------------------|---------|
| Has `Dockerfile`, `.github/`, `deploy/`, or `infra/` | runbooks, postmortems |
| Has `CHANGELOG.md` or release tagging | changelogs |
| Has `onboarding/`, `setup/`, or `getting-started/` | onboarding |
| Has meeting minutes, agendas, retros, or standups | meetings |
| Has `src/`, `lib/`, `api/`, or `services/` | rfcs |
| Has research, customer, or market files | briefs |
| Any project with decisions and requirements | adrs, prds (always lean default) |

---

## Step 3: Make the core docs explicit project state

The required core documents are the operational state surface for the repo. All LLMs working here should read and maintain them:

- `.construct/context.md`
- `.construct/context.json`
- `.construct/workflow.json`
- `docs/README.md`
- `docs/architecture.md`

Fill these in based on the user's answers and the actual repo shape. Treat them as required maintenance targets, not decorative docs.

---

## Step 4: Create skeleton files

Each created file should have a minimal, useful skeleton: not just a title. Skeletons should include:
- A one-line description of what goes in this file
- Section headings relevant to the doc type
- A note at the top that the file is required project state and all LLMs should keep it current.

### `docs/README.md` skeleton

```markdown
# [Project Name] — Documentation

> Required project state. All LLMs working in this repo, including Construct, should keep this file updated.

## What's here

| Directory | Contents |
|-----------|----------|
[fill based on created subdirs]

## Ownership

Maintained by: [team/person or Construct]
Last updated: [date]
```

### `docs/architecture/overview.md` skeleton (if architecture dir created)

```markdown
# Architecture Overview

> Required project state. All LLMs working in this repo, including Construct, should keep this file updated.

## System overview

[Describe the system in 2-3 sentences]

## Key components

[List main components and their responsibilities]

## Data flow

[Describe how data moves through the system]

## Key decisions

Link to `docs/decisions/adr/` or the canonical project decision log used in this repo.
```

---

## Step 5: Tell the repo how upkeep works

After creating the files, instruct the user:

> After init, all LLMs working in this repo should read `.construct/context.md`, `.construct/context.json`, `.construct/workflow.json`, `docs/README.md`, and `docs/architecture.md` as project state. When work changes project reality, update the affected file before calling the work done.

Also create or update `.construct/context.md` with a summary of what was just set up:

```markdown
# Project Context

Updated: [date]

## Documentation structure initialized

Created docs/ with: [list created dirs]
Core docs: .construct/context.md, .construct/context.json, .construct/workflow.json, docs/README.md, docs/architecture.md
Project type: [type]
Stack: [stack]

## What agents should know

[Fill with any key constraints, active work, or decisions the user mentioned]
```

---

## Routing

After completing the docs init:
- If the user has architecture questions → `@cx-explorer` or `@cx-docs-keeper` to explore and update `docs/architecture/`
- If the user wants to document a decision → record it in `docs/decisions/adr/` using the ADR template
- If the user wants to add API docs → `@cx-docs-keeper` to generate stubs from code
- If the user wants to file an incident report → use `docs/postmortems/` with the incident-report template
- If the user wants to document a release → use `docs/changelogs/` with the changelog-entry template
