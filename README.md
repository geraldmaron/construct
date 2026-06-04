# Construct

**One AI interface. A team of specialists behind it. Hard gates. Runs locally, or deploys for teams.**

📖 **[Read the docs →](https://geraldmaron.github.io/construct/)** · 🚀 **[5-minute quickstart →](https://geraldmaron.github.io/construct/start)** · 📦 `npm install -g @geraldmaron/construct`

---

> Heads up. I'm not a developer. Construct is a side project I'm vibe-coding to learn in public. There will be bugs, rough edges, and things that change without warning. The code is open source, the issues queue is real, and contributions are welcome. If you need production-grade tooling today, this isn't it yet.

Construct sits on top of Claude Code, OpenCode, Codex, Cursor, and Copilot. You talk to one persona called `construct`. Behind it is a team of specialists shaped by your **org profile**: software R&D by default, with curated profiles for operations, creative, and research orgs, plus a schema-validated escape hatch for custom profiles. Each profile organizes its specialists by department (Product, Engineering, Operations, etc.) and carries its own intake taxonomy, doc templates, and role set. Sessions survive boundary changes via durable state in `.cx/`, beads, and a local vector index. Solo by default. Can deploy centrally for teams that want shared memory, telemetry, queues, and policy.

`construct profile show|list|set <id>` to switch. See [Profile lifecycle](https://geraldmaron.github.io/construct/concepts/profile-lifecycle) for how new profiles are built (it's a research process, not a JSON exercise).

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
construct init --yes
```

`construct init` scaffolds the project (`.cx/`, `AGENTS.md`, `plan.md`, adapters) and starts the local services by default. Pass `--no-start` to skip service startup, or `--interactive` for the guided flow.

Open your editor and talk to `@construct`. A walkthrough lives in `construct_guide.md` at your project root.

No Node? Try `brew install geraldmaron/construct/construct`. Cloning a project that already uses Construct? `npx -y @geraldmaron/construct init` wires it up.

[Five minute walkthrough](https://geraldmaron.github.io/construct/start).

## Usage

Most days, the loop is:

```bash
construct status          # confirm services and editor adapters are healthy
construct sync            # refresh host adapters after registry, prompt, or config changes
construct intake list     # review new signals, if your project uses the inbox
construct doctor          # diagnose install, service, MCP, and adapter drift
```

In your editor, start with `@construct`. Ask for the outcome, not the specialist. Construct routes to the right specialist chain, keeps durable state in `.cx/` and Beads, and blocks risky mutations until the configured gates pass.

## What you can do

| If you want to... | Read |
|---|---|
| Install and run a first task | [Start](https://geraldmaron.github.io/construct/start) |
| Understand how it works | [Architecture](https://geraldmaron.github.io/construct/concepts/architecture) |
| Pick a deployment mode | [Deployment model](https://geraldmaron.github.io/construct/concepts/deployment-model) |
| Drop a signal and triage it | [Intake and triage](https://geraldmaron.github.io/construct/concepts/intake-and-triage) |
| Add a custom specialist | [Add a custom specialist](https://geraldmaron.github.io/construct/cookbook/add-a-custom-agent) |
| Fix a blocked commit or red CI | [Fix a policy violation](https://geraldmaron.github.io/construct/cookbook/fix-a-policy-violation) |
| Plug in your own LLM | [Plug in your own LLM](https://geraldmaron.github.io/construct/cookbook/plug-in-your-own-llm) |
| Look up a CLI command | [CLI reference](https://geraldmaron.github.io/construct/reference/cli) |

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible providers.

## Deployment modes

Three modes. `solo` is the default and runs everything locally. Filesystem queue, local repo state, optional Postgres via Docker, local JSONL traces. If every cloud service goes down, you still work from `plan.md`, `.cx/context.md`, beads, git, and the local vector index.

`team` promotes the intake queue to Postgres with row-locked worker claims. Shared memory, Docker worker pool, centralized telemetry, MCP through a broker.

`enterprise` adds tenant isolation, RBAC and ABAC scaffolding, isolated worker containers, signed MCP allowlists, and mandatory audit.

Pick or change modes with `construct config mode [solo|team|enterprise]`. [Deployment model](https://geraldmaron.github.io/construct/concepts/deployment-model).

## Intake

Anything dropped into `.cx/inbox/` (a bug report, a customer comment, a competitor PDF, a postmortem draft) is classified by the active profile's intake taxonomy. The default `rnd` profile uses bug, user-signal, experiment, architecture, incident, security, requirement, research, ops, eval-finding, launch-asset, legal-compliance. The `operations` profile uses request, incident, ops, security, docs. The `creative` profile uses brief, content-request, asset, experiment, report. The `research` profile uses question, study, synthesis, report.

Each signal gets a primary owner and a recommended handoff chain. Inspect with `construct intake list` and `construct intake show <id>`. Generate a task graph with `construct graph from-intake <id>`. The classifier runs in the daemon and is deterministic. The agent in your editor does the actual analysis. [Intake and triage](https://geraldmaron.github.io/construct/concepts/intake-and-triage).

### Document ingestion fidelity

`construct ingest <file>` extracts text from PDF, DOCX, XLSX, PPTX, HTML, plain text, email, and audio/video. High-fidelity extraction is the default and routes through a [docling](https://github.com/docling-project/docling) Python sidecar (MIT, IBM, donated to LF AI & Data) provisioned via [`uv`](https://github.com/astral-sh/uv); audio and video route through [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) (Metal-accelerated on macOS).

First run downloads `uv` and creates `.cx/runtime/docling/.venv` (~1.5 GB including PyTorch). Audio requires a system `whisper-cli` binary — `brew install whisper-cpp` on macOS. Pass `--strict` to fail on any extraction info loss; pass `--legacy-extractor` to use the pre-docling regex path. Any silent drops (image-heavy PDFs, scanned pages with low OCR yield) are surfaced as `droppedInfo` in the CLI output.

## Hard gates

Every code mutation runs through enforcement. No secrets committed, tests green, docs current, comments lint-clean, CI passes. Gates live in three places: write-time, commit-time, CI safety net. They can only be bypassed with explicit env vars so every exception leaves an audit trail. [Gates and enforcement](https://geraldmaron.github.io/construct/concepts/gates-and-enforcement).

## Learning loops

Construct gets smarter on its own. Every session ends with an automatic capture: tools used, files touched, what the final reply said. That goes into `.cx/observations/` and is searchable from the next session. See [`docs/concepts/learning-loops.mdx`](./docs/concepts/learning-loops.mdx) for what's wired, what's coming, and how to turn pieces off.

## `.cx/` is local-only runtime state

`construct init` writes a runtime state tree at `.cx/` inside the project root: observations, sessions, vector index, intake packets, task graphs, and traces. **It's local-only and must never be committed.** `construct init` adds `.cx/` to your project's `.gitignore` automatically (idempotent: it won't double-add if you already have it). Daily trace shards (`.cx/traces/<date>.jsonl`) cap at 100 MB and rotate to `<date>.<n>.jsonl` so a stray commit never crosses GitHub's single-file limit. Override the cap with `CONSTRUCT_TRACE_MAX_MB`.

The embed daemon writes its supervisor stdout log to `~/.cx/runtime/embed-daemon.log`. That log rotates every minute at 50 MB and keeps 5 gzipped segments by default; override via `CONSTRUCT_EMBED_LOG_MAX_MB` and `CONSTRUCT_EMBED_LOG_MAX_SEGMENTS`.

## Core commands

<!-- AUTO:commands -->
### Core

| Command | What it does |
|---|---|
| `construct dashboard` | Start the local dashboard/orchestration daemon (or --token to mint a dashboard token) |
| `construct dev` | Start services for development |
| `construct docs` | Documentation commands |
| `construct doctor` | Check installation health |
| `construct init` | Project setup (once per repo): scaffold .cx/, AGENTS.md, plan.md, adapters |
| `construct install` | Machine setup (once per machine): Docker, cm/cass, config, embeddings |
| `construct intake` | View and process the active profile's intake queue (queue label varies by profile) |
| `construct profile` | Manage the active org profile and its lifecycle (draft, promote, archive, health) |
| `construct recommendations` | View and manage artifact recommendations |
| `construct sandbox` | Isolated tmpdir-based environment for QA / specialist dry-runs |
| `construct status` | Show system health and credentials |
| `construct stop` | Stop all running services |
| `construct sync` | Sync agent adapters to AI tools |

### Work

| Command | What it does |
|---|---|
| `construct ask` | One-shot ask against the active knowledge index |
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct graph` | Task graph management |
| `construct handoffs` | List and inspect session handoff files in .cx/handoffs/ |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct reflect` | Capture improvement feedback from chat session and update Construct core |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct tags` | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `construct team` | Team review and template listing |
| `construct wireframe` | Generate wireframes from description |
| `construct workflow` | Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs) |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

### Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Describe what this Construct install can do (embedded contract; read-only, secret-free) |
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct execution` | Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced) |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct orchestrate` | Construct-owned local orchestration runtime, in-process or against the local daemon (--remote) |
| `construct plugin` | Manage external Construct plugin manifests |

### Integrations

| Command | What it does |
|---|---|
| `construct creds` | Manage provider credentials (set, rotate, revoke, list) |
| `construct ollama` | Manage local Ollama models |
| `construct providers` | Provider status, circuit-breaker reset, and resource discovery |

### Observability

| Command | What it does |
|---|---|
| `construct efficiency` | Show read efficiency, repeated files, and context-budget guidance |
| `construct eval-datasets` | Sync scored traces from the telemetry backend into eval datasets for prompt regression testing |
| `construct evals` | Show evaluator catalog for prompt and agent experiments |
| `construct feedback:history` | Show recorded outcome ratings |
| `construct feedback:record` | Record an outcome rating for a recent specialist invocation |
| `construct llm-judge` | Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback |
| `construct optimize` | Prompt optimization using telemetry trace quality scores |
| `construct review` | Generate agent performance review from the configured telemetry trace backend |
| `construct telemetry` | Query telemetry traces and latency data |
| `construct telemetry-backfill` | Backfill sparse traces with observations (trace backend) |
| `construct telemetry-setup` | Configure telemetry backend credentials and trace export (OTLP or Langfuse-compatible) |

### Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct docs:check` | Check for missing how-to guides (alias for `docs check`) |
| `construct docs:reconcile` | Reconcile docs against the registry |
| `construct docs:site` | Manage the docs static site build |
| `construct docs:update` | Regenerate AUTO-managed doc regions (alias for `docs update`) |
| `construct docs:verify` | Validate documentation quality (alias for `docs verify`) |

### Advanced

| Command | What it does |
|---|---|
| `construct auth:status` | Check auth status |
| `construct backup` | System backups |
| `construct beads` | Task queue management |
| `construct beads:stats` | Show beads counters and drift summary |
| `construct ci` | Local CI mirror: run CI jobs locally or view recent run status |
| `construct completions` | Shell completion scripts |
| `construct config` | Deployment mode configuration |
| `construct decisions` | Index load-bearing decisions and their enforcement bindings |
| `construct deployment` | Deployment posture tools (capability parity contract) |
| `construct diff` | Show agent changes since HEAD |
| `construct embed` | Embed mode management |
| `construct gates:audit` | Audit policy gates |
| `construct hooks:health` | Check hook health |
| `construct list` | List all agents |
| `construct policy` | Show active policy gates with enforcement details |
| `construct provider` | Provider management |
| `construct role` | Role framework management |
| `construct roles:list` | List installed role contracts |
| `construct roles:set` | Activate a role contract |
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
- [`docs/concepts/architecture.mdx`](./docs/concepts/architecture.mdx). Canonical architecture.
- [`AGENTS.md`](./AGENTS.md). Agent operating contract.

## Project structure

<!-- AUTO:structure -->
```text
construct/
├── apps             User-facing apps shipped from this repo (e.g. apps/docs/, the Next.js docs site)
├── bin              CLI entrypoint (`construct`)
├── commands         Command prompt assets
├── config
├── dashboard
├── db
├── deploy
├── docs             Architecture notes, runbooks, and documentation contract
├── examples
├── lib              Core runtime: CLI, hooks, MCP, status, sync, workflow
├── packages
├── personas         Persona prompt definitions
├── platforms
├── profiles
├── providers
├── rules            Coding and quality standards
├── schemas
├── scripts
├── services
├── skills           Reusable domain knowledge files
├── specialists
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
