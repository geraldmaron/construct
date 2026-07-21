---
name: docs-init-project
description: "Use when: starting work on a new project or joining an existing one without doc structure."
inputs: [repo]
artifactType: docs-scaffold
---
# Project Initialization

Use when: starting work on a new project or joining an existing one without doc structure.

## Command
```bash
construct init --docs-preset=lean [path]   # defaults to current directory; presets: lean | product | full
# or lane-specific init:
construct init [path] [--docs-preset=lean|product|full]   # unified bootstrap (preferred)
construct init --docs-preset=lean [path]                  # docs-only lean preset
```

`npm run docs:init` is deprecated — use `construct init --docs-preset=*` instead.

## What it creates
```
.construct/                    ← agent session memory and decisions
  context.md
  context.json
  workflow.json
  decisions/
  research/
  reviews/
docs/                   ← human-readable project documentation
  README.md
  architecture.md
  runbooks/
```

## After init
1. Treat `.construct/context.md`, `.construct/context.json`, `.construct/workflow.json`, `docs/README.md`, and `docs/architecture.md` as required project state.
2. Read them at the start of every meaningful session.
3. Update them whenever work changes active reality: decisions, workflow phase, architecture assumptions, or documentation contract.
4. Run `construct status` to review the project's current state (workflow phase, core docs, uncommitted changes).

## For cx-docs-keeper
At session start, check the core docs set. If missing, suggest running `construct init --docs-preset=lean` (or `construct init --docs-preset=full` for the full lane set).
At session end, update the affected core docs so the next LLM session inherits current project reality.

## For all LLMs working in the repo

These files are not optional documentation. They are the repo's shared operating state:

- `.construct/context.md`
- `.construct/context.json`
- `.construct/workflow.json`
- `docs/README.md`
- `docs/architecture.md`

If your work changes project reality, update the affected file before calling the task done.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.
