# construct — Documentation

> Required project state. All LLMs working in this repo, including Construct, must keep the core documents below current.

<!-- AUTO:core-docs -->
## Required core documents

| File | Purpose | Update when |
|---|---|---|
| `.cx/context.md` | Human-readable resumable project context | Active work, decisions, architecture assumptions, or open questions change |
| `.cx/context.json` | Machine-readable resumable context | Context state needs to stay in sync with `.cx/context.md` |
| `.cx/workflow.json` | Canonical workflow/task state | Non-trivial work starts, changes phase, or completes |
| `docs/README.md` | Docs index and maintenance contract | Core docs set or maintenance expectations change |
| `docs/architecture.md` | Canonical architecture and invariants | Runtime shape, contracts, boundaries, or major dependencies change |

All LLMs working in the repo, including Construct, must read these as project state and keep them current when work changes project reality.
<!-- /AUTO:core-docs -->

## Contents

- [Architecture](./architecture.md)
- [Prompt surface architecture](./prompt-surfaces.md)
- [Templates and role anti-patterns](./templates/README.md)
- [Runbooks](./runbooks/)
- [ADRs](../.cx/decisions/) — session-context decisions (longer ADRs live in `docs/adr/`)
- [Plans](../.cx/plans/) — canonical Construct plans that feed `workflow_import_plan` into `.cx/workflow.json` task packets (beads)
- [Skills](../skills/) — domain knowledge organized by area (compliance, architecture, AI, development, devops, etc.)

## Prompt surfaces

`docs/prompt-surfaces.md` is the canonical reference for the prompt architecture.

It defines:

- the sole public persona surface
- internal specialist prompts and role overlays
- offline-only example fixtures
- the required fixture coverage policy

## Prompt examples

Shipped prompt example fixtures live under `examples/`.

They are the canonical place for:

- Construct public persona fixtures under `examples/personas/construct/**`
- internal role fixtures under `examples/internal/roles/**`
- labeled bad, boundary, and adversarial cases without bloating runtime prompts

## Maintenance

After updating the Construct repo checkout itself, run `construct update` from inside that checkout to reinstall the current source globally and refresh synced host adapters before continuing work.

## Ownership

Maintained by: Construct contributors
Last updated: 2026-04-23
