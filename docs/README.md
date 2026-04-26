# construct — Documentation

> Required project state. All LLMs working in this repo, including Construct, must keep the core documents below current.

<!-- AUTO:core-docs -->
## Required core documents

| File | Purpose | Update when |
|---|---|---|
| `AGENTS.md` | Canonical agent operating contract | Workflow rules, tracker hierarchy, or repo-wide guardrails change |
| `plan.md` | Human-readable implementation plan linked to tracker work | The active plan changes, is superseded, or should be pruned |
| `.cx/context.md` | Human-readable resumable project context | Active work, decisions, architecture assumptions, or open questions change |
| `.cx/context.json` | Machine-readable resumable context | Context state needs to stay in sync with `.cx/context.md` |
| `docs/README.md` | Docs index and maintenance contract | Core docs set or maintenance expectations change |
| `docs/architecture.md` | Canonical architecture and invariants | Runtime shape, contracts, boundaries, or major dependencies change |

Tracker hierarchy: external tracker (prefer Beads) for durable work, `plan.md` for the current plan, and cass-memory via MCP `memory` for cross-session recall.

`AGENTS.md` is the canonical agent instruction file. On case-sensitive filesystems you may also add a lowercase `agents.md` shim for tools that require it.
All LLMs working in the repo, including Construct, must read these as project state, keep them current when work changes project reality, and prune stale sections instead of letting managed docs drift.
<!-- /AUTO:core-docs -->

## Contents

- [Architecture](./architecture.md)
- [Prompt surface architecture](./prompt-surfaces.md)
- [Templates and role anti-patterns](./templates/README.md)
- [Runbooks](./runbooks/)
- [ADRs](../.cx/decisions/) — session-context decisions (longer ADRs live in `docs/adr/`)
- [Plans](../.cx/plans/) — plan artifacts and supporting specs for tracker-linked work
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

When a managed file stops reflecting repo reality, update it or prune the stale section. Managed docs are not archives.

Parallel work rule: one writer per file. If multiple agent or harness sessions are active, coordinate ownership through the tracker and `plan.md` instead of editing the same file concurrently.

## Ownership

Maintained by: Construct contributors
Last updated: 2026-04-23
