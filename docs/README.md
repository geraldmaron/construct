# construct documentation

> Required project state. All LLMs working in this repo, including Construct, must keep the core documents below current.

<!-- AUTO:core-docs -->
## Required core documents

| File | Purpose | Update when |
|---|---|---|
| `AGENTS.md` | Canonical agent operating contract | Workflow rules, tracker hierarchy, or repo-wide guardrails change |
| `.cx/context.md` | Human-readable resumable project context | Active work, decisions, architecture assumptions, or open questions change |
| `.cx/context.json` | Machine-readable resumable context | Context state needs to stay in sync with `.cx/context.md` |
| `docs/README.md` | Docs index and maintenance contract | Core docs set or maintenance expectations change |
| `docs/concepts/architecture.mdx` | Canonical architecture and invariants | Runtime shape, contracts, boundaries, or major dependencies change |

`plan.md` is a local working document. `construct init` creates it for the active session, but it is gitignored and not committed; durable work belongs in the tracker (Beads or external).

Tracker hierarchy: external tracker (prefer Beads) for durable work, `plan.md` for the local working plan, and cass-memory via MCP `memory` for cross-session recall.

`AGENTS.md` is the canonical agent instruction file. On case-sensitive filesystems you may also add a lowercase `agents.md` shim for tools that require it.
All LLMs working in the repo, including Construct, must read these as project state, keep them current when work changes project reality, and prune stale sections instead of letting managed docs drift.
<!-- /AUTO:core-docs -->

## File format: `.md` vs `.mdx`

Use **`.md`** for every prose page (CommonMark + YAML frontmatter). Reserve **`.mdx`** only when a page embeds `@cx/ui` MDX components (`<FlowPipeline>`, `<RequestFlow>`, `<Callout>`, …). The docs site compiles both through the same pipeline: prose-only bodies are sanitized and rendered as Markdown; JSX pages stay on the MDX path (`apps/docs/lib/docs-source.ts` → `prepareDocBody`).

## Contents

- [Start](./start/). Install, initialize a project, connect an editor, and run the first task
- [Architecture](./concepts/architecture.mdx). Runtime shape, boundaries, and system map
- [Agents and personas](./concepts/agents-and-personas.mdx). One public persona with specialists behind it
- [Deployment model](./concepts/deployment-model.mdx). Solo, team, and enterprise topology
- [Prompt surface architecture](./concepts/prompt-surfaces.mdx). Persona, specialist, skill, rule, and fixture surfaces
- [Knowledge layout](./concepts/knowledge-layout.md). `.cx/` directory structure, inbox routing, and durable knowledge lanes
- [Intake and triage](./concepts/intake-and-triage.mdx). How dropped signals become owner-assigned work
- [Gates and enforcement](./concepts/gates-and-enforcement.mdx). Write-time, commit-time, and CI guardrails
- [Style](./STYLE.md). Voice, punctuation, structure rules (canonical reference for prose lint)
- [Learning loops](./concepts/learning-loops.mdx). What is wired vs aspirational across A1-A4
- [Profile lifecycle](./concepts/profile-lifecycle.md). Draft → promote → archive flow for org-type profiles
- [Persona and skill research](./concepts/persona-research.md). Methodology grounded in Goodwin, Cooper, Galbraith STAR, Bloom
- [Release policy](./maintenance/release-policy.md). When to tag
- [Release and deploy automation](./maintenance/release-and-deploy.md). What fires when you tag, plus the failure-mode lookup
- [Templates and role anti-patterns](./templates/README.md)
- [Runbooks](./runbooks/)
- [ADRs](./adr/). Architecture decision records (public site lane)
- [Skills](../skills/). Domain knowledge organized by area (compliance, architecture, AI, development, devops, etc.)
- [Functional tests pattern](../tests/functional/README.md). When and how to add an end-to-end test

## Maintainer lanes (not on the public site)

These directories stay in git for Construct maintainers. They are excluded from the published docs site and not linked from README.

- [Audit snapshots](./audit/). Dated alignment scorecards and baseline evidence
- [Research notes](./research/). Competitive audits and synthesis reports
- [PRDs](./prd/). Draft product requirements for this repo
- [Roadmap](./roadmap.md). Generated placeholder (excluded from public site)
- [Tests audit](../tests/AUDIT.md). Category-by-category survey of test files

## How-to guides

Step-by-step operator guides for common tasks:

- [Quick start](./cookbook/quick-start.md)
- [Use the inbox](./cookbook/use-the-inbox.mdx)
- [Configure Slack](./cookbook/configure-slack.md)
- [Configure GitHub](./cookbook/configure-github.md)
- [Configure Jira and Confluence](./cookbook/configure-jira-confluence.md)
- [Override the storage root (`CX_DATA_DIR`)](./cookbook/override-storage-root.md)
- [Manage providers](./cookbook/manage-providers.md)
- [Plug in your own LLM](./cookbook/plug-in-your-own-llm.mdx)
- [Generate artifacts](./cookbook/generate-artifacts.mdx)
- [Query the knowledge base](./cookbook/query-the-knowledge-base.md)
- [Observability and cost](./cookbook/observability-and-cost.md)
- [Wireframe and drop commands](./cookbook/wireframe-and-drop.md)
- [Distill and infer commands](./cookbook/distill-and-infer.md)
- [Sync the dashboard static bundle](./cookbook/sync-the-dashboard.md)

## Command Coverage

Use the generated [CLI reference](./reference/cli/) for exact flags and subcommands. The docs index intentionally points advanced commands to the reference when a dedicated tutorial would add little beyond the command help.

- Core: `construct docs`, `construct recommendations`, `construct sandbox`
- Workflows and knowledge: `construct customer`, `construct graph`, `construct integrations`, `construct reflect`, `construct tags`, `construct workflow`, `construct workspace`
- Models and integrations: `construct claude:allow`, `construct creds`, `construct ollama`
- Observability and diagnostics: `construct llm-judge`, `construct telemetry`, `construct cleanup`
- Administration: `construct auth:status`, `construct backup`, `construct beads`, `construct completions`, `construct gates:audit`, `construct hooks:health`, `construct role`, `construct scheduler`, `construct uninstall`, `construct upgrade`

## Prompt surfaces

`docs/concepts/prompt-surfaces.mdx` is the canonical reference for the prompt architecture.

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
Last updated: 2026-06-19
