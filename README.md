# Construct

**One AI interface. A team of specialists behind it. Hard gates. Runs locally, or deploys for teams.**

📖 **[Read the docs →](https://geraldmaron.github.io/construct/)** · 🚀 **[5-minute quickstart →](https://geraldmaron.github.io/construct/docs/start)** · 📦 `npm install -g @geraldmaron/construct`

---

> Heads up. Construct is an open source project I started. I am not a developer. This is a side project. There may be bugs, there may be defects, but I'm building it to learn in public. If you'd like to contribute, please do.

Construct sits on top of Claude Code, OpenCode, Codex, Cursor, and Copilot. You talk to one persona called `construct`. Behind it is a team of specialists shaped by your **org profile**: software R&D by default, with curated profiles for operations, creative, and research orgs, plus a schema-validated escape hatch for custom profiles. Each profile organizes its specialists by department (Product, Engineering, Operations, etc.) and carries its own intake taxonomy, doc templates, and role set. Sessions survive boundary changes via durable state in `.cx/`, beads, and a local vector index. Solo by default. Can deploy centrally for teams that want shared memory, telemetry, queues, and policy.

`construct profile show|list|set <id>` to switch. See [Profile lifecycle](https://geraldmaron.github.io/construct/docs/concepts/profile-lifecycle) for how new profiles are built (it's a research process, not a JSON exercise).

The team and enterprise modes exist because I wanted to learn what shipping a real multi-tenant tool would look like. The project is still open source, the code is still public, and the bar is still "does this help me learn." Run it solo if that's all you need.

## Getting started

Install the CLI (once per machine):

```bash
npm install -g @geraldmaron/construct
```

Bootstrap local services (once per machine):

```bash
construct install --yes
```

Initialize a project:

```bash
cd ~/your-project
construct init --auto-start
```

Open your editor and talk to `@construct`. A walkthrough lives in `construct_guide.md` at your project root.

No Node? Try `brew install geraldmaron/construct/construct`. Cloning a project that already uses Construct? `npx -y @geraldmaron/construct init` wires it up.

[Five minute walkthrough](https://geraldmaron.github.io/construct/docs/start).

## What you can do

| If you want to... | Read |
|---|---|
| Install and run a first task | [Start](https://geraldmaron.github.io/construct/docs/start) |
| Understand how it works | [Architecture](https://geraldmaron.github.io/construct/docs/concepts/architecture) |
| Pick a deployment mode | [Deployment model](https://geraldmaron.github.io/construct/docs/concepts/deployment-model) |
| Drop a signal and triage it | [Intake and triage](https://geraldmaron.github.io/construct/docs/concepts/intake-and-triage) |
| Add a custom specialist | [Add a custom agent](https://geraldmaron.github.io/construct/docs/cookbook/add-a-custom-agent) |
| Fix a blocked commit or red CI | [Fix a policy violation](https://geraldmaron.github.io/construct/docs/cookbook/fix-a-policy-violation) |
| Plug in your own LLM | [Plug in your own LLM](https://geraldmaron.github.io/construct/docs/cookbook/plug-in-your-own-llm) |
| Look up a CLI command | [CLI reference](https://geraldmaron.github.io/construct/docs/reference/cli) |

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible providers.

## Deployment modes

Three modes. `solo` is the default and runs everything locally. Filesystem queue, local repo state, optional Postgres via Docker, local JSONL traces. If every cloud service goes down, you still work from `plan.md`, `.cx/context.md`, beads, git, and the local vector index.

`team` promotes the intake queue to Postgres with row-locked worker claims. Shared memory, Docker worker pool, centralized telemetry, MCP through a broker.

`enterprise` adds tenant isolation, RBAC and ABAC scaffolding, isolated worker containers, signed MCP allowlists, and mandatory audit.

Pick or change modes with `construct config mode [solo|team|enterprise]`. [Deployment model](https://geraldmaron.github.io/construct/docs/concepts/deployment-model).

## Intake

Anything dropped into `.cx/inbox/` (a bug report, a customer comment, a competitor PDF, a postmortem draft) is classified by the active profile's intake taxonomy. The default `rnd` profile uses bug, user-signal, experiment, architecture, incident, security, requirement, research, ops, eval-finding, launch-asset, legal-compliance. The `operations` profile uses request, incident, ops, security, docs. The `creative` profile uses brief, content-request, asset, experiment, report. The `research` profile uses question, study, synthesis, report.

Each signal gets a primary owner and a recommended handoff chain. Inspect with `construct intake list` and `construct intake show <id>`. Generate a task graph with `construct graph from-intake <id>`. The classifier runs in the daemon and is deterministic. The agent in your editor does the actual analysis. [Intake and triage](https://geraldmaron.github.io/construct/docs/concepts/intake-and-triage).

## Hard gates

Every code mutation runs through enforcement. No secrets committed, tests green, docs current, comments lint-clean, CI passes. Gates live in three places: write-time, commit-time, CI safety net. They can only be bypassed with explicit env vars so every exception leaves an audit trail. [Gates and enforcement](https://geraldmaron.github.io/construct/docs/concepts/gates-and-enforcement).

## Learning loops

Construct gets smarter on its own. Every session ends with an automatic capture: tools used, files touched, what the final reply said. That goes into `.cx/observations/` and is searchable from the next session. See [`docs/concepts/learning-loops.md`](./docs/concepts/learning-loops.md) for what's wired, what's coming, and how to turn pieces off.

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
| `construct intake` | View and process the active profile's intake queue (queue label varies by profile) |
| `construct models` | Manage AI model assignments |
| `construct profile` | Manage the active org profile and its lifecycle (draft, promote, archive, health) |
| `construct recommendations` | View and manage artifact recommendations |
| `construct sandbox` | Isolated tmpdir-based environment for QA / specialist dry-runs |
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
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct reflect` | Capture improvement feedback |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct tags` | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `construct team` | Team review and templates |
| `construct wireframe` | Generate wireframes from description |
| `construct workflow` | Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs) |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

### Integrations

| Command | What it does |
|---|---|
| `construct claude:allow` | Manage Claude Code permissions |
| `construct creds` | Manage provider credentials (set, rotate, revoke, list) |
| `construct hosts` | Check host capabilities |
| `construct mcp` | Manage MCP integrations |
| `construct ollama` | Manage local Ollama models |
| `construct plugin` | Manage plugin manifests |
| `construct providers` | Provider status, circuit-breaker reset, and resource discovery |

### Observability

| Command | What it does |
|---|---|
| `construct efficiency` | Read efficiency metrics |
| `construct evals` | Evaluator catalog |
| `construct llm-judge` | LLM-as-judge evaluations |
| `construct optimize` | Prompt optimization |
| `construct review` | Agent performance review |
| `construct telemetry` | Query telemetry traces and latency data |

### Advanced

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals |
| `construct auth:status` | Check auth status |
| `construct backup` | System backups |
| `construct beads` | Task queue management |
| `construct ci` | Local CI mirror: run CI jobs locally or view recent run status |
| `construct cleanup` | Clean stale processes |
| `construct completions` | Shell completion scripts |
| `construct config` | Deployment mode configuration |
| `construct diff` | Show agent changes since HEAD |
| `construct embed` | Embed mode management |
| `construct gates:audit` | Audit policy gates |
| `construct hooks:health` | Check hook health |
| `construct list` | List all agents |
| `construct policy` | Show active policy gates with enforcement details |
| `construct provider` | Provider management |
| `construct role` | Role framework management |
| `construct scheduler` | Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup) |
| `construct skills` | Skill relevance detection |
| `construct uninstall` | Remove Construct state |
| `construct update` | Reinstall this checkout |
| `construct upgrade` | Upgrade to latest npm version |
| `construct validate` | Validate registry structure |
| `construct version` | Show version |
<!-- /AUTO:commands -->

## For contributors

- [`CONTRIBUTING.md`](./CONTRIBUTING.md). Branch workflow, gates, review expectations.
- [`CHANGELOG.md`](./CHANGELOG.md). Release history.
- [`docs/concepts/architecture.md`](./docs/concepts/architecture.md). Canonical architecture.
- [`AGENTS.md`](./AGENTS.md). Agent operating contract.

## Project structure

<!-- AUTO:structure -->
```text
construct/
├── agents           Registry and generated platform adapter chains
├── apps             User-facing apps shipped from this repo (e.g. apps/docs/, the Fumadocs docs site)
├── bin              CLI entrypoint (`construct`)
├── commands         Command prompt assets
├── dashboard
├── db
├── deploy
├── docs             Architecture notes, runbooks, and documentation contract
├── examples
├── lib              Core runtime: CLI, hooks, MCP, status, sync, workflow
├── personas         Persona prompt definitions
├── platforms
├── profiles
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

Run the uninstaller first, then remove the package:

```bash
construct uninstall          # interactive; pick what to remove
npm uninstall @geraldmaron/construct
```

`construct uninstall` finds both project state (`.construct/`, the Construct-owned files under `.claude/agents/` and `.claude/commands/`, hooks and mcpServers Construct added to `.claude/settings.json`) and machine state (`~/.cx/`, `~/.construct/workspace/`, the embedding model cache, the local Postgres container). Auto-risk items go by default. Ask-risk items (Postgres data, API keys, files you may have edited) are skipped unless you opt in.

It will not touch Docker itself, Homebrew CLIs like `cm` and `cass`, the pgvector image, or anything you added to `.claude/settings.json` by hand. Those appear in the final summary as follow-ups.

Useful flags:

```bash
construct uninstall --dry-run            # show the plan, change nothing
construct uninstall --yes                # non-interactive, auto-risk only
construct uninstall --yes --all          # non-interactive, everything
construct uninstall --scope=project      # only this project, leave ~/.construct alone
construct uninstall --keep-state         # only .construct/ and .claude/, keep .cx/, ~/.construct, Postgres
```

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
