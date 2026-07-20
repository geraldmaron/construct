# Construct

**One governed AI interface. Canonical Worker Profiles, Procedures, Capabilities, and hard gates.**

📖 **[Read the docs →](https://geraldmaron.github.io/construct/)** · 🚀 **[5-minute quickstart →](https://geraldmaron.github.io/construct/start)** · 📦 `npm install -g @geraldmaron/construct`

---

> Heads up. I'm not a developer. Construct is a side project I'm vibe-coding to learn in public. There will be bugs, rough edges, and things that change without warning. The code is open source, the issues queue is real, and contributions are welcome. If you need production-grade tooling today, this isn't it yet.

Construct sits on top of Claude Code, OpenCode, Codex, Cursor, and Copilot. The current product surface is defined by the canonical registry: Workspace Presets select configuration, Worker Profiles provide bounded execution identity, Procedures describe reusable sequences, and Assignments connect work to Capabilities and Policies. Sessions persist in `.construct/`, Beads, and optional local retrieval state.

`construct workspace-preset list|show <id>` inspects the curated workspace-wide defaults (`rnd`, `operations`, `creative`, `research`). Set the active preset with `workspacePreset` in `construct.config.json`. See [Workspace Preset lifecycle](https://geraldmaron.github.io/construct/concepts/workspace-preset-lifecycle) for how new presets are researched and promoted.

The team and enterprise modes exist because I wanted to learn what shipping a real multi-tenant tool would look like. The project is still open source, the code is still public, and the bar is still "does this help me learn." Run it solo if that's all you need.

## Getting started

Install the CLI (once per machine):

```bash
npm install -g @geraldmaron/construct
```

> [!NOTE]
> npm may print deprecation warnings for `boolean` and `node-domexception` during install. Both are transitive dependencies of upstream packages (`@huggingface/transformers` → `onnxruntime-node` → `global-agent` → `boolean`; `@lancedb/lancedb` → `openai@4.29.2` → `formdata-node` → `node-domexception`) and are harmless. They cannot be silenced from this package — `@lancedb/lancedb` pins `openai@4.29.2` exactly, and npm ignores a package's own `overrides` on end-user installs.

Bootstrap local services (once per machine, opt-in to machine-scope writes):

```bash
construct install --footprint=user --yes
```

`construct install` requires an explicit `--footprint` — a bare invocation hard-errors naming the flag rather than silently writing nothing. `--footprint=project` prints footprint guidance without writing anything (see the [footprint contract](#footprint-contract) below or [ADR 0029](docs/decisions/adr/0029-install-scopes-and-hook-budgets.md)); use `--footprint=user` for machine setup, `--footprint=both` for both.

Initialize a project:

```bash
cd ~/your-project
construct init --yes
```

`construct init` scaffolds the project (`.construct/`, `AGENTS.md`, `plan.md`, adapters) and starts the local services by default. Pass `--no-start` to skip service startup, or `--interactive` for the guided flow.

Open your editor and talk to `@construct`. A walkthrough lives in `.construct/construct_guide.md` (gitignored — local reference only).

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

In your editor, start with `@construct`. Ask for the outcome, not a Worker Profile name. Construct routes to the right Assignment chain, keeps durable state in `.construct/` and Beads, and blocks risky mutations until the configured gates pass.

## What you can do

| If you want to... | Read |
|---|---|
| Install and run a first task | [Start](https://geraldmaron.github.io/construct/start) |
| Understand how it works | [Architecture](https://geraldmaron.github.io/construct/concepts/architecture) |
| Pick a deployment mode | [Deployment model](https://geraldmaron.github.io/construct/concepts/deployment-model) |
| Drop a signal and triage it | [Intake and triage](https://geraldmaron.github.io/construct/concepts/intake-and-triage) |
| Add a custom Worker Profile | [Worker Profiles reference](https://geraldmaron.github.io/construct/reference/worker-profiles) and [Workspace Preset lifecycle](https://geraldmaron.github.io/construct/concepts/workspace-preset-lifecycle) |
| Fix a blocked commit or red CI | [Fix a policy violation](https://geraldmaron.github.io/construct/cookbook/fix-a-policy-violation) |
| Plug in your own LLM | [Plug in your own LLM](https://geraldmaron.github.io/construct/cookbook/plug-in-your-own-llm) |
| Use Construct conversationally | [Connect your editor](https://geraldmaron.github.io/construct/start/connect-your-editor) |
| Check fleet health (Oracle) | [Architecture — Oracle](https://geraldmaron.github.io/construct/concepts/architecture) |
| Look up a CLI command | [CLI reference](https://geraldmaron.github.io/construct/reference/cli) |

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible providers.

## Deployment modes

Three modes are defined. Only `solo` is fully implemented today.

**`solo`** (default and fully supported) — runs entirely on the local machine. Filesystem task queue, local repo state, embedded LanceDB vector store, direct MCP dispatch, local JSONL traces. If every cloud service goes down, you still work from `plan.md`, `.construct/context.md`, beads, git, and the local vector index.

**`team`** (planned — partially implemented) — the architecture is defined: shared run storage, Postgres queue with row-locked worker claims, shared memory store, Docker worker pool, centralized telemetry, MCP through a broker. The SQL client, migrations, Postgres run store, Postgres queue provider, team-mode queue default, and worker registry heartbeat now exist. A missing database is a configuration error unless `CONSTRUCT_DEGRADED_OK=postgres-queue` is set, which visibly falls back to the git queue. Do not run `team` mode expecting full distributed execution yet.

**`enterprise`** (planned — not yet implemented) — would add tenant isolation, RBAC/ABAC scaffolding, isolated worker containers, signed MCP allowlists, and mandatory audit. No implementation exists yet.

Pick or change modes with `construct config mode [solo|team|enterprise]`. [Deployment model](https://geraldmaron.github.io/construct/concepts/deployment-model).

### Deployment mode capability status

Current implementation state, sourced from `lib/mode-capabilities.mjs`:

| Capability | solo | team | enterprise |
|---|---|---|---|
| Filesystem task queue | implemented | — | — |
| Local memory | implemented | — | — |
| Embedded LanceDB vector store | implemented | — | — |
| Direct MCP dispatch | implemented | — | — |
| Postgres task queue | — | implemented | implemented |
| Worker heartbeat registry | — | implemented | implemented |
| Shared memory store | — | stub | stub |
| Central telemetry | — | stub | — |
| Brokered MCP dispatch | — | stub | — |
| Docker worker pool | — | not implemented | not implemented |
| Tenant isolation | — | — | not implemented |
| RBAC/ABAC | — | — | not implemented |
| Isolated worker containers | — | — | not implemented |
| Signed MCP allowlists | — | — | not implemented |
| Mandatory audit log | — | — | not implemented |

**stub** = code path exists but returns null or falls back silently. **not implemented** = no code path exists.

## Intake

Anything dropped into `inbox/` (a bug report, a customer comment, a competitor PDF, a postmortem draft) is classified by the active profile's intake taxonomy. The default `rnd` profile uses bug, user-signal, experiment, architecture, incident, security, requirement, research, ops, eval-finding, launch-asset, legal-compliance. The `operations` profile uses request, incident, ops, security, docs. The `creative` profile uses brief, content-request, asset, experiment, report. The `research` profile uses question, study, synthesis, report.

Each signal gets a primary owner and a recommended handoff chain. Inspect with `construct intake list` and `construct intake show <id>`. Generate a task graph with `construct graph from-intake <id>`. The classifier runs in the daemon and is deterministic. The agent in your editor does the actual analysis. [Intake and triage](https://geraldmaron.github.io/construct/concepts/intake-and-triage).

### Document ingestion fidelity

`construct ingest <file>` extracts text from PDF, DOCX, XLSX, PPTX, HTML, plain text, email, and audio/video. High-fidelity extraction is the default and routes through a [docling](https://github.com/docling-project/docling) Python sidecar (MIT, IBM, donated to LF AI & Data) provisioned via [`uv`](https://github.com/astral-sh/uv); audio and video route through [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) (Metal-accelerated on macOS).

First run downloads `uv` and creates `~/.construct/runtime/docling/.venv` (~1.5 GB including PyTorch, shared across every project on the machine). Audio requires a system `whisper-cli` binary — `brew install whisper-cpp` on macOS. Pass `--strict` to fail on any extraction info loss; pass `--legacy-extractor` to use the pre-docling regex path. Any silent drops (image-heavy PDFs, scanned pages with low OCR yield) are surfaced as `droppedInfo` in the CLI output.

## Hard gates

Every code mutation runs through enforcement. No secrets committed, tests green, docs current, comments lint-clean, CI passes. Gates live in three places: write-time, commit-time, CI safety net. Quality gates fire unconditionally; if a gate fires wrong, repair the policy — do not bypass it. [Gates and enforcement](https://geraldmaron.github.io/construct/concepts/gates-and-enforcement).

## Footprint contract

Construct's writes are scoped and disclosed up front. The default `construct install` (no flag) writes nothing — it prints footprint guidance. Project writes happen only under `construct init` inside a project directory; machine writes happen only under `construct install --footprint=user`, with an itemized interactive consent prompt for any global Claude Code config mutation.

| Footprint | Trigger | Paths |
|---|---|---|
| Project | `construct init` | `.construct/` (config layer + nested `.construct/launcher/`), `.claude/` adapter tree, host adapters (`.codex/`, `.opencode/`, `.cursor/`, `.vscode/`), `construct.config.json`, marker block in `CLAUDE.md` / `AGENTS.md`, `.gitignore` append, `.beads/` |
| Machine | `construct install --footprint=user` | `~/.config/construct/config.env`, `~/.config/construct/lib` (symlink), `~/.config/construct/services/` (e.g. `postgres/` compose files), `~/.local/state/construct/` (daemon state, workspace scaffold, vector-index fallback), `~/.cache/construct/embeddings`, `~/Library/LaunchAgents/` (macOS), MCP entries in `~/.config/opencode/opencode.json` and `~/.codex/config.toml`, marker block in `~/.claude/CLAUDE.md`, hook injection in `~/.claude/settings.json` (last two require interactive consent or `--yes`) |
| Never touched | — | Shell rc files (`~/.bashrc`, `~/.zshrc`), npm global config, `git config --global` |

Full table with file:line citations and the per-hook performance budget contract: [Architecture — Footprint contract](https://geraldmaron.github.io/construct/concepts/architecture#footprint-contract) and [ADR 0029](docs/decisions/adr/0029-install-scopes-and-hook-budgets.md).

## Learning loops

Construct gets smarter on its own. Every session ends with an automatic capture: tools used, files touched, what the final reply said. That goes into `.construct/observations/` and is searchable from the next session. See [`docs/guides/concepts/learning-loops.mdx`](./docs/guides/concepts/learning-loops.mdx) for what's wired, what's coming, and how to turn pieces off.

## `.construct/` is local-only runtime state

`construct init` writes a runtime-marker tree at `.construct/` inside the project root: context, observations, sessions, intake packets, and task graphs, alongside the config layer. **It is local-only and must never be committed.** See [Project scopes](docs/guides/concepts/project-scopes.md) for the full directory breakdown.

Heavier, regenerable state — traces and the LanceDB vector index — lives outside the project entirely, at the machine-scoped `~/.construct/projects/<key>/` (keyed by git remote so every clone/worktree of the same repo shares it; ADR-0066), not under the project's own `.construct/`. Trace shards (`~/.construct/projects/<key>/traces/<date>.jsonl`) cap at 100 MB and rotate to `<date>.<n>.jsonl` so a stray commit never crosses GitHub's single-file limit. Override the cap with `CONSTRUCT_TRACE_MAX_MB`.

The embed daemon writes its supervisor stdout log to the machine's XDG state directory — `~/.local/state/construct/runtime/embed-daemon.log` by default (override the root with `CONSTRUCT_DOCTOR_ROOT`). That log rotates every minute at 50 MB and keeps 5 gzipped segments by default; override via `CONSTRUCT_EMBED_LOG_MAX_MB` and `CONSTRUCT_EMBED_LOG_MAX_SEGMENTS`.

## Core commands

<!-- AUTO:commands -->
### Core

| Command | What it does |
|---|---|
| `construct approvals` | Manage pending MCP tool approvals |
| `construct dev` | Start services for development |
| `construct directives` | View standing directives (construct.config.json directives[]) and their due status |
| `construct docs` | Documentation commands |
| `construct doctor` | Check installation health |
| `construct init` | Project setup (once per repo): scaffold .construct/, AGENTS.md, plan.md, adapters |
| `construct install` | Machine setup (footprint per ADR-0029/ADR-0071): --footprint=project\|user\|both, default project |
| `construct intake` | View and process the active profile's intake queue (queue label varies by profile) |
| `construct oracle` | Oracle meta-controller — fleet health review and bounded-auto maintenance |
| `construct recommendations` | View and manage artifact recommendations |
| `construct sandbox` | Isolated tmpdir-based environment for QA and worker dry-runs |
| `construct status` | Show system health and credentials |
| `construct stop` | Stop all running services |
| `construct sync` | Sync agent adapters to AI tools |
| `construct workers` | List registered workers and heartbeat freshness |
| `construct workspace-preset` | Inspect reusable workspace-wide defaults |

### Work

| Command | What it does |
|---|---|
| `construct artifact` | Plan or locally execute manifest-backed artifact procedures with execution provenance |
| `construct ask` | One-shot ask against the active knowledge index |
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct demo` | Run guided tours or record VHS/asciinema tapes |
| `construct diagram` | Render code-driven diagrams via D2/Graphviz (optional system binaries; ADR-0001) |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct export` | Export markdown to PDF, DOCX, HTML, and other Pandoc formats via Pandoc + Typst (optional system binaries; ADR-0024) |
| `construct graph` | Task graph management |
| `construct handoffs` | List and inspect session handoff files in .construct/handoffs/ |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct pack` | Worker profile and workspace preset pack lifecycle |
| `construct procedure` | Inspect and invoke reusable deterministic procedures |
| `construct publish` | Publish typed artifacts: release gate + export PDF with figures + optional demos |
| `construct reflect` | Capture improvement feedback and update Construct core |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct synthesize` | Cross-project synthesis: map each registered project, reduce to an origin-cited answer |
| `construct tags` | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `construct tools` | Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright) |
| `construct tracker-projection` | Beads projection, field authority, and reconciliation (construct-b0nny.27, target-model.md concept 16) — treats bd as a projection of the graph-informed Work model with explicit per-field authority, detect-and-report drift, and read-only raw-record-preserving import. Sits behind bd; issues no bd write. |
| `construct wireframe` | Generate wireframes from description |
| `construct work-spec` | Work spec schema + graph-informed decomposition check (construct-b0nny.23, target-model.md concepts 6/7/9) — cycle detection, declared-dependency graph resolution, and independence-claim verification over a Work spec's decomposition. |
| `construct worker-profile` | Inspect assignable worker configurations |
| `construct workplace-loop` | Production sources/directives/workplace loop (construct-b0nny.25) — detects real signals from a connected source, checks them against Workspace strategy, and routes any proposed external effect through the governed-write chokepoint. |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |
| `construct workspace-domain` | Workspace domain model (construct-b0nny.22, target-model.md concept 1) — owner, membership, settings, lifecycle. Distinct from `construct workspace` above, which is the unrelated multi-PM signal-routing command. |

### Models & Integrations

| Command | What it does |
|---|---|
| `construct acp` | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `construct capability` | Inspect typed operations the system can perform |
| `construct claude:allow` | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `construct db` | Inspect and migrate the optional Postgres backend |
| `construct execution` | Resolve the execution-capability contract for an embedded procedure (orchestrated vs prompt-only; descriptive, not enforced) |
| `construct flow` | Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status |
| `construct hosts` | Show host support for Construct orchestration |
| `construct mcp` | Manage MCP integrations |
| `construct models` | Show or update model tier assignments |
| `construct orchestrate` | Construct-owned local orchestration runtime and readiness preflight |
| `construct plugin` | Manage external Construct plugin manifests |
| `construct tracker` | Analyze registered projects and contribute governed issue proposals to an external tracker (Jira) |

### Integrations

| Command | What it does |
|---|---|
| `construct creds` | Manage provider credentials (login, set, rotate, revoke, list, test) |
| `construct ollama` | Manage local Ollama models |
| `construct providers` | Provider status, circuit-breaker reset, and resource discovery |

### Observability

| Command | What it does |
|---|---|
| `construct efficiency` | Show read efficiency, repeated files, and context-budget guidance |
| `construct eval-datasets` | Sync scored traces from the telemetry backend into eval datasets for prompt regression testing |
| `construct evals` | Show evaluator catalog for prompt and agent experiments |
| `construct feedback:history` | Show recorded outcome ratings |
| `construct feedback:record` | Record an outcome rating for a recent worker invocation |
| `construct improvement` | Governed improvement loop — review, approve, and record apply/rollback for proposals |
| `construct llm-judge` | Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback |
| `construct optimize` | Prompt optimization using telemetry trace quality scores |
| `construct review` | Agent performance review from telemetry (run\|legacy), or a deterministic PR-diff review for CI (pr) |
| `construct telemetry` | Query telemetry traces and latency data |
| `construct telemetry-backfill` | Backfill sparse traces with observations (trace backend) |
| `construct telemetry-setup` | Configure telemetry backend credentials and trace export (OTLP or Langfuse-compatible) |

### Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct certify` | Inspect and run scenario-based certification under .construct/certification/ |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct docs:check` | Check for missing how-to guides (alias for `docs check`) |
| `construct docs:reconcile` | Reconcile docs against the registry |
| `construct docs:site` | Regenerate generated reference pages under docs/guides/reference/ |
| `construct docs:update` | Regenerate AUTO-managed doc regions (alias for `docs update`) |
| `construct docs:verify` | Validate documentation quality (alias for `docs verify`) |
| `construct impact` | Change-impact analysis — map changed files to affected tests, capabilities, and procedures |
| `construct rules` | Rule and hook reference telemetry rollup |

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
| `construct monitor` | One-command setup for continuous monitoring-as-a-role: sources.targets + embed.yaml roles + capability enable + daemon start |
| `construct policy` | Inspect rules governing authority, approval, and external effects |
| `construct provider` | Provider management |
| `construct role` | Role framework management |
| `construct roles:list` | List installed role contracts |
| `construct roles:set` | Activate a role contract |
| `construct scheduler` | Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup) |
| `construct server` | Shared workspace server with authentication, a Postgres-backed Workspace store, and a worker-claim queue for multi-user deployments. |
| `construct skills` | Skill relevance detection |
| `construct sources` | Manage typed integration source targets in construct.config.json |
| `construct templates` | List doc templates and register custom document classes (project-tier overlay; builtin manifest untouched) |
| `construct uninstall` | Remove Construct state |
| `construct update` | Reinstall this checkout |
| `construct upgrade` | Upgrade to latest npm version |
| `construct validate` | Validate registry structure |
| `construct version` | Show version |
<!-- /AUTO:commands -->

## For contributors

- [`CONTRIBUTING.md`](./CONTRIBUTING.md). Branch workflow, gates, review expectations.
- [`CHANGELOG.md`](./CHANGELOG.md). Release history.
- [`docs/guides/concepts/architecture.mdx`](./docs/guides/concepts/architecture.mdx). Canonical architecture.
- [`AGENTS.md`](./AGENTS.md). Agent operating contract.

## Project structure

<!-- AUTO:structure -->
```text
construct/
├── apps             User-facing apps shipped from this repo (dashboard, docs)
├── bin              CLI entrypoint (`construct`)
├── commands         Command prompt assets
├── config           Repo-wide controlled vocabulary (tag-vocabulary.json)
├── deploy           Terraform and deployment configs
├── deps
├── dev
├── docs             Architecture notes, runbooks, and documentation contract
├── examples         Example projects and persona fixtures
├── lib              Core runtime: CLI, hooks, MCP, providers, oracle, sync
├── packages         Shared workspace packages
├── platforms        Host adapter capability configs
├── registry         Product capability registry
├── rules            Coding and quality standards
├── schemas          Registry and config JSON Schema
├── scripts          Audit, alignment, release, and sync scripts
├── skills           Reusable domain knowledge files
├── templates        Doc and workflow templates
├── tests            Test suite
├── vendor
```
<!-- /AUTO:structure -->

## Uninstall

Run the uninstaller first, then remove the package:

```bash
construct uninstall          # interactive; pick what to remove
npm uninstall @geraldmaron/construct
```

`construct uninstall` finds both project state (`.construct/`, the Construct-owned files under `.claude/agents/` and `.claude/commands/`, hooks and mcpServers Construct added to `.claude/settings.json`) and machine state (`~/.local/state/construct/` for daemon state/logs plus the workspace dir and vector-index fallback, `~/.cache/construct/embeddings` for the embedding model cache, `~/.config/construct/config.env` for saved API keys). Auto-risk items go by default. Ask-risk items (API keys, files you may have edited) are skipped unless you opt in.

It will not touch Homebrew CLIs like `cm` and `cass`, or anything you added to `.claude/settings.json` by hand. Those appear in the final summary as follow-ups.

Useful flags:

```bash
construct uninstall --dry-run            # show the plan, change nothing
construct uninstall --yes                # non-interactive, auto-risk only
construct uninstall --yes --all          # non-interactive, everything
construct uninstall --scope=project      # only this project, leave machine state (~/.config/construct, ~/.local/state/construct, ~/.cache/construct) alone
construct uninstall --keep-state         # remove only the launcher + .claude adapters; keep .construct/ (config + session state) and all machine state
```

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
