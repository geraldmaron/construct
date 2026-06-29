---
cx_doc_id: skill-effectiveness-rubric
---

# Skill effectiveness rubric

Structural validation (`lib/validators/skills.mjs`) is the floor. Effectiveness validation (`lib/validators/skill-effectiveness.mjs`) checks that skills are usable in production, not just well-formed.

## Enforcement

| Gate | Command |
|------|---------|
| Scope + structure + effectiveness + composition | `npm run lint:scopes` |
| Full corpus | `tests/skills-effectiveness.test.mjs` |
| Composition graph | `construct audit skills --composition` |
| Inventory blocking | `tests/certification/skills/inventory.json` must have zero `blockingFindings` |

## Category expectations

### Role overlays (`skills/roles/**`)

- ≥3 numbered failure modes with Symptom and Counter-move (or Counter)
- Base roles include Self-check, Methodology, or Ship Check
- `scopes:` frontmatter lists applicable work scopes
- `applies_to` matches ADR-0047 specialist bindings

### Workflow skills (`skills/docs/*-workflow.md`)

- `verificationBar` ≥40 characters, testable against artifact release gate
- `artifactType` set (may differ from manifest type when orchestrating)
- ≥4 numbered steps; mentions `construct artifact validate`
- Specialist ids exist in registry; `get_skill("…")` paths resolve

### Domain skills

- Body ≥400 characters after frontmatter
- Boundary in description or body (`Use when`, `When not to use`, etc.)

### Quality gates and brand

- Executable checklists mapped to reviewers
- `brand/output-vibe` frontmatter `name: brand-output-vibe`; cited by customer-facing workflows

## Composition

`lib/skills/composition-graph.mjs` audits routing.json targets, registry entitlements, and workflow `get_skill` chains. Unreachable non-role skills are blocking.

See also: `rules/common/skill-composition.md`.
