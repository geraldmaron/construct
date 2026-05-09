<!--
skills/docs/init-project.md — Project Initialization — Use when: starting work on a new project or joining an existing one without doc

Use when: starting work on a new project or joining an existing one without doc structure. ## Command
-->
# Project Initialization

Use when: starting work on a new project or joining an existing one without doc structure.

## Command
```bash
construct init-docs [path]   # defaults to current directory
```

## What it creates
```
.cx/                    ← agent session memory and decisions
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
1. Treat `.cx/context.md`, `.cx/context.json`, `.cx/workflow.json`, `docs/README.md`, and `docs/architecture.md` as required project state.
2. Read them at the start of every meaningful session.
3. Update them whenever work changes active reality: decisions, workflow phase, architecture assumptions, or documentation contract.
4. Run `construct serve` to see the project in the dashboard.

## For cx-docs-keeper
At session start, check the core docs set. If missing, suggest running `construct init-docs`.
At session end, update the affected core docs so the next LLM session inherits current project reality.

## For all LLMs working in the repo

These files are not optional documentation. They are the repo's shared operating state:

- `.cx/context.md`
- `.cx/context.json`
- `.cx/workflow.json`
- `docs/README.md`
- `docs/architecture.md`

If your work changes project reality, update the affected file before calling the task done.
