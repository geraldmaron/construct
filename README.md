# Construct

> One AI interface. 28 specialists. Hard gates. Runs locally or deploys for teams.

Construct is a deployable AI R&D operating system. You address one persona — `construct` — in Claude Code, OpenCode, Codex, Cursor, or Copilot. Behind that persona is a team of 28 specialists (architect, engineer, reviewer, QA, security, designer, …) under typed contracts and enforced gates. Sessions survive boundary changes via durable state in `.cx/`, beads, and the vector index. Construct runs locally for individual users (the default) and can be deployed centrally for shared team usage with shared memory, telemetry, queues, and policy.

**Full docs:** [`geraldmaron.github.io/construct/v2/`](https://geraldmaron.github.io/construct/v2/) (Phase 1) · while the new docs site is rolling out, the legacy MkDocs site still serves the root URL.

## Get started in 5 minutes

### Step 1: Install CLI (one-time, per machine)

```bash
npm install -g @geraldmaron/construct
```

### Step 2: Machine Setup (one-time, per machine)

First time on a new machine, bootstrap local services. `construct install` auto-spins local Postgres + Langfuse via Docker and prints your Langfuse login at the end:

```bash
construct install --yes
# Local services:
#   Langfuse: http://localhost:54330
#     Web login: admin@construct.local / construct-admin
#   Postgres: postgresql://construct:construct@127.0.0.1:54329/construct
```

### Step 3: Initialize Project (per project)

```bash
cd ~/your-project
construct init --auto-start
```

The postinstall hook stages `.construct/` and `.claude/` into your project, so hooks, agents, and slash commands are wired up automatically. Peers who clone your repo and run `npm install` get the same setup with no extra steps.

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
### Core

| Command | What it does |
|---|---|
| `construct dev` | Start services for development |
| `construct docs` | Documentation commands |
| `construct doctor` | Check installation health |
| `construct init` | Initialize project and start services |
| `construct install` | Machine setup: install Docker, cm, and bootstrap config |
| `construct intake` | View and process R&D intake queue |
| `construct models` | Manage AI model assignments |
| `construct recommendations` | View and manage artifact recommendations |
| `construct status` | Show system health and credentials |
| `construct stop` | Stop all running services |
| `construct sync` | Sync agent adapters to AI tools |

### Work

| Command | What it does |
|---|---|
| `construct bootstrap` | Import seed observations |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct graph` | Task graph management |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct memory` | Inspect memory layer |
| `construct reflect` | Capture improvement feedback |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct team` | Team review and templates |
| `construct wireframe` | Generate wireframes from description |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

### Integrations

| Command | What it does |
|---|---|
| `construct claude:allow` | Manage Claude Code permissions |
| `construct hosts` | Check host capabilities |
| `construct mcp` | Manage MCP integrations |
| `construct ollama` | Manage local Ollama models |
| `construct plugin` | Manage plugin manifests |

### Observability

| Command | What it does |
|---|---|
| `construct cost` | Token usage and cost breakdown |
| `construct efficiency` | Read efficiency metrics |
| `construct evals` | Evaluator catalog |
| `construct llm-judge` | LLM-as-judge evaluations |
| `construct optimize` | Prompt optimization |
| `construct review` | Agent performance review |

### Advanced

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals |
| `construct auth:status` | Check auth status |
| `construct backup` | System backups |
| `construct beads` | Task queue management |
| `construct cleanup` | Clean stale processes |
| `construct completions` | Shell completion scripts |
| `construct config` | Deployment mode configuration |
| `construct diff` | Show agent changes since HEAD |
| `construct embed` | Embed mode management |
| `construct gates:audit` | Audit policy gates |
| `construct hooks:health` | Check hook health |
| `construct list` | List all agents |
| `construct provider` | Provider management |
| `construct role` | Role framework management |
| `construct skills` | Skill relevance detection |
| `construct uninstall` | Remove Construct state |
| `construct update` | Reinstall this checkout |
| `construct upgrade` | Upgrade to latest npm version |
| `construct validate` | Validate registry structure |
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
