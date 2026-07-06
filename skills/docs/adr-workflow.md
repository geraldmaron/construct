---
name: docs-adr-workflow
description: "Use when: an architectural decision is made that affects the system structure, data model, API contracts, or technology choices."
inputs: [decision-context]
artifactType: adr
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# ADR Workflow

Use when: an architectural decision is made that affects the system structure, data model, API contracts, or technology choices.

## Trigger automatically when
- cx-architect finalizes a design
- A technology is selected over alternatives
- A pattern is established that should be followed project-wide
- A previous decision is reversed or superseded

## Steps

1. **cx-architect** or **cx-engineer** identifies the decision
2. **Write to `docs/decisions/adr/ADR-{NNN}-{slug}.md`** using the template from `get_template("adr")`: resolves `.cx/templates/docs/adr.md` (override) then `templates/docs/adr.md` (shipped)
   - NNN = next sequential number (check existing files)
3. **Also write a shorter entry to `.cx/decisions/`** for session context
4. **cx-operations** updates `.cx/context.md` Architecture Notes with a one-line summary and link

## File naming
- `docs/decisions/adr/ADR-001-use-postgres-over-mysql.md`
- `docs/decisions/adr/ADR-002-jwt-auth-strategy.md`

## Cross-referencing
- If this ADR supersedes another: update the old ADR's status field
- If this ADR depends on another: add a References link
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.
