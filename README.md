# Construct

> One AI interface. 28 specialists. Hard gates. Local-first.

Construct is the orchestration layer behind an agentic software organization. You address one persona — `construct` — in Claude Code, OpenCode, Codex, Cursor, or Copilot. Behind that persona is a team of 28 specialists (architect, engineer, reviewer, QA, security, designer, …) under typed contracts and enforced gates. Sessions survive boundary changes via durable state in `.cx/`, beads, and the local vector index.

**Full docs:** [`geraldmaron.github.io/construct/v2/`](https://geraldmaron.github.io/construct/v2/) (Phase 1) · while the new docs site is rolling out, the legacy MkDocs site still serves the root URL.

## Get started in 5 minutes

```bash
npm install -g @geraldmaron/construct
construct setup --yes
cd ~/your-project && construct init && construct sync
construct up
# Open your editor and address @construct
```

[Full 5-minute walkthrough →](https://geraldmaron.github.io/construct/v2/docs/start)

## What you can do with it

| If you want to... | Read |
|---|---|
| Install + first task | [Start](https://geraldmaron.github.io/construct/v2/docs/start) |
| Understand how it works | [Concepts → Architecture](https://geraldmaron.github.io/construct/v2/docs/concepts/architecture) |
| Add a custom specialist | [Cookbook → Add a custom agent](https://geraldmaron.github.io/construct/v2/docs/cookbook/add-a-custom-agent) |
| Fix a blocked commit or red CI | [Cookbook → Fix a policy violation](https://geraldmaron.github.io/construct/v2/docs/cookbook/fix-a-policy-violation) |
| Plug in your own LLM | [Cookbook → Plug in your own LLM](https://geraldmaron.github.io/construct/v2/docs/cookbook/plug-in-your-own-llm) |
| Deploy to AWS | [Cookbook → Deploy to AWS](https://geraldmaron.github.io/construct/v2/docs/cookbook/deploy-to-aws) |
| Look up a CLI command | [Reference → CLI](https://geraldmaron.github.io/construct/v2/docs/reference/cli) |
| Recover from an outage | [Operations → Troubleshooting](https://geraldmaron.github.io/construct/v2/docs/operations/troubleshooting) |

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible providers.

## Local-first by design

If Postgres, Langfuse, the dashboard, or every cloud service goes down, Construct still works from `plan.md`, `.cx/context.md`, the latest handoff, beads, git, and the local vector index. There is no Construct cloud account. There is no required hosted service.

## Hard gates

Every code mutation runs through enforcement: no secrets committed, tests green, docs current, comments lint-clean, CI passes. Gates live in three places (write-time, commit-time, CI safety-net) and can only be bypassed with explicit env vars so every exception leaves an audit trail. [Concepts → Gates and enforcement](https://geraldmaron.github.io/construct/v2/docs/concepts/gates-and-enforcement).

## Core commands

<!-- AUTO:commands -->
### Services

| Command | What it does |
|---|---|
| `construct beads` | Manage beads lock and queue, or run bd commands |
| `construct completions` | Generate or print shell completion scripts for construct |
| `construct down` | Stop all running services |
| `construct serve` | Start the Construct dashboard (auto-selects port) |
| `construct setup` | Bootstrap user config after npm or manual install |
| `construct show` | Show runtime service URLs and live status (compat view) |
| `construct status` | Show canonical system health across runtime and integrations |
| `construct up` | Start services (memory, dashboard) |
| `construct update` | Reinstall this checkout globally, then sync and verify hosts |

### Agents & Sync

| Command | What it does |
|---|---|
| `construct list` | Show all personas and specialist agents |
| `construct role` | Inspect or manage role-framework pending invocations |
| `construct sync` | Generate agent adapters for all platforms |

### Work

| Command | What it does |
|---|---|
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct distill` | Distill documents with query-focused, citation-ready chunk selection |
| `construct docs:verify` | Validate documentation completeness and quality |
| `construct drop` | Ingest the most recent file dropped into ~/Downloads, Desktop, Documents, or iCloud Drive |
| `construct headhunt` | Create a temporary domain expertise overlay or promotion request |
| `construct infer` | Infer a structured field schema from one or more documents using AI |
| `construct ingest` | Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts in the knowledge base |
| `construct init` | Bootstrap Construct project state and documentation system |
| `construct init-docs` | Stand up opinionated docs lanes and per-lane templates without overwriting existing docs |
| `construct init:update` | Update existing project to current documentation standards |
| `construct memory` | Inspect or consolidate the memory layer |
| `construct reflect` | Capture improvement feedback from chat session and update Construct core |
| `construct search` | Run hybrid file, SQL, and semantic retrieval over core project state |
| `construct storage` | Sync and inspect the hybrid storage backend |
| `construct team` | Team review and template listing |
| `construct wireframe` | Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description |

### Models & Integrations

| Command | What it does |
|---|---|
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct plugin` | Manage external Construct plugin manifests |

### Observability

| Command | What it does |
|---|---|
| `construct cost` | Show token usage, cost, cache read rate, and per-agent breakdown |
| `construct efficiency` | Show read efficiency, repeated files, and context-budget guidance |
| `construct eval-datasets` | Sync scored Langfuse traces into eval datasets for prompt regression testing |
| `construct evals` | Show evaluator catalog for prompt and agent experiments |
| `construct llm-judge` | Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback |
| `construct optimize` | Prompt optimization using Langfuse trace quality scores |
| `construct review` | Generate agent performance review from Langfuse trace backend |
| `construct telemetry-backfill` | Backfill sparse traces with observations (trace backend) |

### Docs

| Command | What it does |
|---|---|
| `construct dashboard:sync` | Sync the built dashboard bundle into lib/server/static for the HTTP server |
| `construct docs:check` | Report CLI commands that have no linked how-to guide in docs/README.md |
| `construct docs:site` | Generate site/docs/ content for the MkDocs GitHub Pages site |
| `construct docs:update` | Regenerate AUTO-managed regions in README and docs/ |
| `construct lint:comments` | Check all files against the comment policy (rules/common/comments.md) |
| `construct lint:research` | Check research and evidence artifacts for minimum structure and evidence metadata |

### Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct backup` | Create, verify, restore, list, or prune full system backups (observations, sessions, config, registry, Postgres). |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct diff` | Show which agents changed prompts or settings since HEAD |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct doctor` | Run installation health checks (default), or manage the L0 doctor daemon |
| `construct gates:audit` | Audit policy gates across CI, local hooks, and branch protection; flag gaps |
| `construct skills` | Detect project tech stack and scope installed skills to relevance |
| `construct validate` | Validate registry.json structure and field constraints |
| `construct version` | Show version |
<!-- /AUTO:commands -->

## For contributors

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch workflow, gates, review expectations.
- [`CHANGELOG.md`](./CHANGELOG.md) — release history.
- [`docs/architecture.md`](./docs/architecture.md) — canonical architecture (mirrored to the docs site at [Concepts → Architecture](https://geraldmaron.github.io/construct/v2/docs/concepts/architecture)).
- [`AGENTS.md`](./AGENTS.md) — agent operating contract.

## Project structure

<!-- AUTO:structure -->
```text
construct/
├── agents           Registry and generated platform adapter chains
├── apps             User-facing apps shipped from this repo (e.g., apps/docs/ — Fumadocs docs site)
├── bin              CLI entrypoint (`construct`)
├── commands         Command prompt assets
├── dashboard
├── db
├── deploy
├── docs             Architecture notes, runbooks, and documentation contract
├── examples
├── langfuse         Langfuse trace backend for agent observability
├── lib              Core runtime: CLI, hooks, MCP, status, sync, workflow
├── personas         Persona prompt definitions
├── platforms
├── providers
├── rules            Coding and quality standards
├── schemas
├── scripts
├── services
├── site             MkDocs source for the GitHub Pages documentation site
├── skills           Reusable domain knowledge files
├── templates
├── tests            Test suite
```
<!-- /AUTO:structure -->

## Uninstall

```bash
npm uninstall -g @geraldmaron/construct
rm -rf ~/.construct ~/.cx
```

That removes the global install, your user config, and the project-state index. Project-local `.cx/` and `.beads/` dirs stay in each repo — delete those if you want a clean slate.

## License

Elastic License 2.0. See [`LICENSE`](./LICENSE).
