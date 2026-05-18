# Construct

> One AI interface. 28 specialists. Hard gates. Runs locally or deploys for teams.

Construct is a deployable AI R&D operating system. You address one persona — `construct` — in Claude Code, OpenCode, Codex, Cursor, or Copilot. Behind that persona is a team of 28 specialists (architect, engineer, reviewer, QA, security, designer, …) under typed contracts and enforced gates. Sessions survive boundary changes via durable state in `.cx/`, beads, and the vector index. Construct runs locally for individual users (the default) and can be deployed centrally for shared team usage with shared memory, telemetry, queues, and policy.

**Full docs:** [`geraldmaron.github.io/construct/v2/`](https://geraldmaron.github.io/construct/v2/) (Phase 1) · while the new docs site is rolling out, the legacy MkDocs site still serves the root URL.

## Get started in 5 minutes

Add Construct to your project's `package.json` like any other dev dependency:

```bash
cd ~/your-project
npm install -D @geraldmaron/construct
```

The postinstall hook stages `.construct/` and `.claude/` into your project, so hooks, agents, and slash commands are wired up automatically. Peers who clone your repo and run `npm install` get the same setup with no extra steps.

First time on a new machine, bootstrap local services. `construct setup` auto-spins local Postgres + Langfuse via Docker and prints your Langfuse login at the end:

```bash
npx construct setup --yes
# Local services:
#   Langfuse: http://localhost:54330
#     Web login: admin@construct.local / construct-admin
#   Postgres: postgresql://construct:construct@127.0.0.1:54329/construct
```

Open your editor and address `@construct`. A friendly orientation lives in `construct_guide.md` at your project root.

If you cloned a project that does not yet pin Construct, run `npx -y @geraldmaron/construct init` once to wire it up. No Node at all? `brew install geraldmaron/construct/construct`.

[Full 5-minute walkthrough →](https://geraldmaron.github.io/construct/v2/docs/start)

## What you can do with it

| If you want to... | Read |
|---|---|
| Install + first task | [Start](https://geraldmaron.github.io/construct/v2/docs/start) |
| Understand how it works | [Concepts → Architecture](https://geraldmaron.github.io/construct/v2/docs/concepts/architecture) |
| Pick a deployment mode | [Concepts → Deployment model](https://geraldmaron.github.io/construct/v2/docs/concepts/deployment-model) |
| Drop a signal and triage it | [Concepts → Intake and triage](https://geraldmaron.github.io/construct/v2/docs/concepts/intake-and-triage) |
| Add a custom specialist | [Cookbook → Add a custom agent](https://geraldmaron.github.io/construct/v2/docs/cookbook/add-a-custom-agent) |
| Fix a blocked commit or red CI | [Cookbook → Fix a policy violation](https://geraldmaron.github.io/construct/v2/docs/cookbook/fix-a-policy-violation) |
| Plug in your own LLM | [Cookbook → Plug in your own LLM](https://geraldmaron.github.io/construct/v2/docs/cookbook/plug-in-your-own-llm) |
| Deploy to AWS | [Cookbook → Deploy to AWS](https://geraldmaron.github.io/construct/v2/docs/cookbook/deploy-to-aws) |
| Look up a CLI command | [Reference → CLI](https://geraldmaron.github.io/construct/v2/docs/reference/cli) |
| Recover from an outage | [Operations → Troubleshooting](https://geraldmaron.github.io/construct/v2/docs/operations/troubleshooting) |

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible providers.

## Deployable: solo, team, or enterprise

Construct has three deployment modes. `solo` (the default) runs everything locally — filesystem queue, local repo state, optional Postgres/Docker/telemetry — so if every cloud service goes down you still work from `plan.md`, `.cx/context.md`, beads, git, and the local vector index. `team` promotes the intake queue to Postgres with row-locked worker claims, shares memory across the team, runs workers in a Docker pool, centralizes telemetry, and routes MCP through a broker. `enterprise` adds tenant isolation, RBAC/ABAC scaffolding, isolated worker containers, signed MCP allowlists, and mandatory audit. Pick or change modes with `construct config mode [solo|team|enterprise]`. [Concepts → Deployment model](https://geraldmaron.github.io/construct/v2/docs/concepts/deployment-model).

## Signals to R&D

Anything dropped into `.cx/inbox/` (a bug report, a customer comment, a competitor PDF, a postmortem draft) is classified into an R&D intake type — bug, user-signal, experiment, eval-finding, architecture, incident, security, requirement, research, ops, or legal-compliance — and assigned a primary owner persona with a recommended handoff chain. Inspect with `construct intake list / show <id>`, generate a task graph with `construct graph from-intake <id>`, and update node status with verifiable evidence as work progresses. The classifier is deterministic and runs in the daemon (no LLM); the agent in your editor handles the actual analysis. [Concepts → Intake and triage](https://geraldmaron.github.io/construct/v2/docs/concepts/intake-and-triage).

## Hard gates

Every code mutation runs through enforcement: no secrets committed, tests green, docs current, comments lint-clean, CI passes. Gates live in three places (write-time, commit-time, CI safety-net) and can only be bypassed with explicit env vars so every exception leaves an audit trail. [Concepts → Gates and enforcement](https://geraldmaron.github.io/construct/v2/docs/concepts/gates-and-enforcement).

## Core commands

<!-- AUTO:commands -->
### Services

| Command | What it does |
|---|---|
| `construct beads` | Manage beads lock and queue, or run bd commands |
| `construct completions` | Generate or print shell completion scripts for construct |
| `construct config` | Inspect or set deployment posture (solo, team, enterprise) |
| `construct down` | Stop all running services |
| `construct serve` | Start the Construct dashboard (auto-selects port) |
| `construct setup` | Bootstrap user config after npm or manual install |
| `construct show` | Show runtime service URLs and live status (compat view) |
| `construct status` | Show canonical system health across runtime and integrations |
| `construct uninstall` | Interactively remove Construct state; never touches Docker, Homebrew, or shared resources |
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
| `construct graph` | Generate and inspect task graphs derived from R&D intake triage |
| `construct headhunt` | Create a temporary domain expertise overlay or promotion request |
| `construct infer` | Infer a structured field schema from one or more documents using AI |
| `construct ingest` | Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts in the knowledge base |
| `construct init` | Bootstrap Construct project state and documentation system |
| `construct init-docs` | Stand up opinionated docs lanes and per-lane templates without overwriting existing docs |
| `construct init:update` | Update existing project to current documentation standards |
| `construct intake` | Inspect and process the R&D intake queue (list/show/done/skip/reopen) |
| `construct memory` | Inspect or consolidate the memory layer |
| `construct reflect` | Capture improvement feedback from chat session and update Construct core |
| `construct search` | Run hybrid file, SQL, and semantic retrieval over core project state |
| `construct storage` | Sync and inspect the hybrid storage backend |
| `construct team` | Team review and template listing |
| `construct wireframe` | Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description |

### Models & Integrations

| Command | What it does |
|---|---|
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
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
- [`docs/concepts/architecture.md`](./docs/concepts/architecture.md) — canonical architecture (rendered on the docs site at [Concepts → Architecture](https://geraldmaron.github.io/construct/docs/concepts/architecture)).
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
├── skills           Reusable domain knowledge files
├── templates
├── tests            Test suite
```
<!-- /AUTO:structure -->

## Uninstall

Run the uninstaller first, then drop the package:

```bash
construct uninstall          # interactive; pick what to remove
npm uninstall @geraldmaron/construct
```

`construct uninstall` probes both project-scope (`.construct/`, the Construct-owned `.claude/agents/` + `.claude/commands/` files, hooks/mcpServers Construct added to `.claude/settings.json`) and machine-scope state (`~/.cx/`, `~/.construct/workspace/`, the embedding model cache, the local Postgres container). Auto-risk items are removed by default; ask-risk items (Postgres data, API keys, AGENTS.md/plan.md you may have edited) are skipped unless you opt in.

It never touches Docker itself, Homebrew CLIs like `cm`/`cass`, the pgvector image, or anything you've added to `.claude/settings.json` by hand. Those appear in the final summary as follow-ups you can run if you want.

Useful flags:

```bash
construct uninstall --dry-run            # show the plan, change nothing
construct uninstall --yes                # non-interactive, auto-risk only
construct uninstall --yes --all          # non-interactive, everything
construct uninstall --scope=project      # only this project; leave ~/.construct alone
construct uninstall --keep-state         # only .construct/ + .claude/; keep .cx/, ~/.construct, Postgres
```

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
