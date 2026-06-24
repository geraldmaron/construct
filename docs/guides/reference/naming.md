---
title: Naming conventions
description: Canonical ID schemes for skills, specialists, capabilities, and MCP calls.
---

# Construct naming conventions

Use these schemes consistently across registry, MCP tools, sync adapters, and documentation.

## Skills

| Context | Format | Example |
|---|---|---|
| MCP `get_skill` path | `category/name` (slashes) | `docs/adr-workflow` |
| Frontmatter `name` | hyphens, no slashes | `docs-adr-workflow` |
| On disk | `skills/<category>/<name>.md` | `skills/docs/adr-workflow.md` |

Never call MCP with frontmatter hyphen names — always use slash paths.

## Specialists

| Context | Format | Example |
|---|---|---|
| Registry `specialists[].name` | kebab-case, no prefix | `product-manager` |
| Adapter / contract id | `cx-` + registry name | `cx-product-manager` |
| Public persona | fixed | `construct` |

## Capabilities

| Context | Format | Example |
|---|---|---|
| Registry id | dot-separated lowercase | `orchestration.routing` |
| Skill dependency ref | slash path | `roles/engineer` |
| Capability skill row id | `skill.<hyphenated-path>` | `skill.roles-engineer` |

## Host adapters

| Host | Config path | MCP key |
|---|---|---|
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| VS Code | `.vscode/mcp.json` | `servers` |
| Claude agents | `.claude/agents/construct.md` | front door only (Single Front Door) |

Regenerate adapters with `npm run adapters` or `construct sync --project`.

## Role-flavor skills (B-composer)

Skills under `skills/roles/<specialist>.<flavor>` are **bound-orphans** in the registry sense — not listed in each specialist's `skills[]` array — but they are reachable at runtime via the **prompt composer** when a specialist's role flavor matches. Examples: `roles/engineer.platform` loads for `cx-engineer` platform work; `roles/reviewer.trace` loads for trace review.

Maintainers triage bound-orphans with `node -e "import('./lib/registry/consolidation.mjs').then(m => console.log(JSON.stringify(m.triageBoundOrphans(),null,2)))"`. The alignment census reports **composer-reachable** (B-composer) separately from **true orphans** (C-merge + D-review). Categories:

| Category | Action |
|---|---|
| A-bind | Wire workflow skills to an owner specialist in `registry.json` |
| B-composer | Role flavors — reachable via prompt composer; no explicit bind required |
| D-review | Manual review before any deletion |

See [`docs/operations/audit/skill-consolidation-proposal-2026-06.md`](/operations/audit/skill-consolidation-proposal-2026-06) for the full triage list.
