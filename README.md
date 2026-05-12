# Construct

> **A note before anything else:** I'm not a developer. I'm just a guy who got curious about an interesting problem space and started tinkering. I vibecoded my way through building this tool to the state you're seeing today. It may be buggy, and you'll probably find things I missed. But I'm committed to keep building it and see where it goes. If you run into something, open an issue — I'm genuinely paying attention.

---

Construct is the orchestration layer behind an agentic software org.

In OpenCode, Claude Code, and similar agent surfaces, you can use Construct as a single entry point: give it the outcome you want, and it routes the work across the right specialists, keeps shared state aligned, and pushes toward a verified result.

You do not manage the handoffs, decide which reviewer to call next, or manually preserve project context between sessions. Construct handles that coordination so the system behaves more like a team than a single chat loop.

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible setups.

## Use It In Agent Surfaces

Construct is meant to be used from inside tools like OpenCode and Claude Code, where it becomes the single entry point for software work.

```text
@construct build the customer portal and ship it when it's verified
@construct fix the login redirect bug
@construct review the payment flow before release
@construct explain how the caching layer works
```

The important shift is that you are not deciding which sub-agent to call, when to pull in review, or how to preserve context between sessions. You ask for the outcome. Construct routes, coordinates, verifies, and follows through.

## What Construct Is

Construct is primarily an orchestration layer, not just a standalone agent and not just a CLI.

- From the user side, Construct feels like one agent you can talk to
- Under the hood, it is an orchestration system that routes work across specialist roles
- The CLI is the support surface for setup, sync, storage, and diagnostics

If you ask "is Construct an agent or an orchestration layer?", the most accurate answer is: it presents as one agent, but its real job is orchestration.

## 💡 The idea

A real organization does not need its founder to coordinate every interaction between design, engineering, QA, and product. Each role knows its job, challenges the others where it sees a gap, and the system self-corrects.

Construct works the same way.

Under the hood it runs a full specialist team: architects, engineers, designers, reviewers, security, QA, product managers, data analysts, SREs, and more. Each one has domain expertise and a mandate to push back on work that is not ready.

You give Construct a goal and it routes, coordinates, verifies, and ships. The CLI exists to bootstrap and maintain that system, but the core product is the agent workflow that runs inside your coding surface.

## ✨ What you get

- **Outcome-driven work** — tell it what you want, not which agent to call
- **A team that challenges itself** — reviewers, security, and QA are peers, not rubber stamps
- **Project state** that stays grounded in tracker truth, durable docs, and memory
- **Health and visibility** instead of guesswork about what's running
- **Telemetry and performance reviews** when you want observability
- **Cross-tool memory** so work carries across different agent surfaces and sessions
- **Hybrid retrieval** over file-state, SQL-ready records, and semantic search
- **Five built-in providers** (GitHub, Jira, Confluence, Slack, Salesforce) plus a plugin contract for your own
- **Security by default** — CSRF protection, CORS allowlist, rate limiting, structured logging
- **Shared storage** with Postgres+pgvector for vector search, or local file index when Postgres isn't available

## Getting Started

The CLI is the setup and support surface for the agent system. Use it to bootstrap Construct locally, initialize repo state, and inspect health.

### Install

Construct supports three installation modes depending on your situation.

#### Project-pinned (recommended for teams)

Add Construct as a project devDependency. The version pins to the project, every contributor gets the same agents and hooks, and `npm install` is the only setup step a peer needs.

```bash
npm install --save-dev @geraldmaron/construct
```

On install, Construct's `postinstall` runs `sync-agents.mjs --project` against the project root, which writes:

- `.claude/agents/<entry>.md` — agent adapters
- `.claude/settings.json` — hooks + MCP server config, with hook commands written as `node .construct/run.mjs hook <name>` so they resolve through the project-local launcher
- `.claude/commands/<entry>.md` — slash commands
- `.construct/run.mjs` — a tiny committed launcher so hooks work even if Construct isn't globally installed

Commit those files. Any peer who clones the repo and runs `npm install` automatically gets the same agent layer — no global Construct install required.

#### Global install

```bash
npm install -g @geraldmaron/construct
construct setup
```

`construct setup` runs an interactive wizard that bootstraps `~/.construct/config.env`, detects optional resources (Postgres, embedding model, Docker), prompts for install consent, and writes hook entries into `~/.claude/settings.json`. If a resource is declined or unavailable, Construct falls back gracefully and notes the degradation.

Once either mode is in place:

```bash
construct status   # runtime health
construct doctor   # installation checks
```

#### Non-Node projects (bootstrap shim)

If your project doesn't use Node, commit the bootstrap shims so any peer can run Construct without a global install:

```bash
construct init   # writes .construct/bootstrap.sh, bootstrap.ps1, run.mjs
```

The POSIX shim (`bootstrap.sh`) detects available runtimes in order — Node npx → Docker → downloaded binary — and forwards all arguments. The PowerShell version (`bootstrap.ps1`) does the same for Windows.

#### Devcontainer teams

```bash
construct init --devcontainer
```

This stages a `.devcontainer/devcontainer.json` and `Dockerfile.devcontainer` into your project. The container pins Construct at the project version and runs `construct setup --auto` on first open. Works with VS Code "Reopen in Container" out of the box.

### Initialize a repo

```bash
construct init
construct init-docs
```

`construct init` bootstraps the shared repo operating files without overwriting existing ones:

- `AGENTS.md`
- `plan.md` — local working document (gitignored)
- `.cx/context.md`
- `.cx/context.json`
- `.cx/inbox/`
- `.construct/run.mjs`, `bootstrap.sh`, `bootstrap.ps1`

`construct init-docs` stands up the durable docs system and starter templates:

- `docs/README.md`
- `docs/adr/`, `docs/intake/`, `docs/memos/`, `docs/notes/`, `docs/prds/` by default
- `docs/<lane>/templates/` for starter templates
- `docs/architecture.md` only when explicitly requested

Both commands are additive-only: existing files are preserved and reported as skipped instead of overwritten.

`construct init-docs` uses a tighter setup flow:

- numbered presets instead of open-text lane entry
- explicit custom-lane input instead of treating any text as a folder name
- consistent plural lane names in the selector: `adrs`, `briefs`, `memos`, `notes`, `prds`, `rfcs`, `runbooks`
- optional architecture doc instead of forcing one into every repo
- `docs/intake/` is the human-facing intake log; raw source files belong in `.cx/inbox/`

For command autocomplete:

```bash
construct completions install
```

For raw source material such as PDFs, spreadsheets, slide decks, and exports, ingest them into retrieval-ready markdown:

```bash
construct ingest ./vendor-drop --sync
construct ingest ./briefing.pdf --target=sibling
```

By default, ingested markdown lands under `.cx/knowledge/internal/`, which keeps it in Construct's file-state retrieval path and ready for later hybrid search.

### Keeping Construct up to date

**If you cloned this repo and are working from source** (the most common case for contributors and people running the latest unreleased build):

```bash
git pull
npm install
npm install -g .
construct sync
construct doctor
```

This pulls the latest, reinstalls the CLI globally from the local checkout, regenerates all platform adapter files, and verifies health. You should do this every time you pull a meaningful update.

If you installed from npm and just want the latest published version:

```bash
npm install -g @geraldmaron/construct
construct sync
construct doctor
```

Or use the built-in shortcut (when running from source):

```bash
construct update
```

`construct update` reinstalls the current checkout globally, refreshes host adapters without rewriting repo docs, and finishes with `construct doctor`.

## ⚙️ How it works

Construct routes the work, tracks state, verifies outcomes, and follows through.

The team challenges itself along the way: reviewers push back on incomplete work, security flags risky patterns, QA confirms it actually works, and project memory stays available across sessions and surfaces. You do not coordinate that manually. You just get the result.

Every request flows through three structural layers:

1. **Gates** — preconditions that must hold before work begins: frame the problem, route authorship to the owning specialist, surface primary sources before opinions
2. **Contract chain** — ordered typed handoffs from `agents/contracts.json`. Each contract names a producer→consumer pair, required fields, preconditions, and expected output shape. Violations are logged with a tamper-evident chain and block the handoff at runtime.
3. **Specialist sequence** — dispatch plan with ordering and parallel markers. Gate-required specialists are auto-prepended.

## 🔌 Providers

Construct connects to external systems through a capability-driven provider interface. Providers are stateless adapters; durable state stays in Construct's core stores.

Five built-in providers ship with 1.0:

| Provider | Capabilities |
|---|---|
| GitHub | read, write, search, webhook |
| Atlassian Jira | read, write, search, webhook |
| Atlassian Confluence | read, write, search |
| Slack | read, write, watch, webhook |
| Salesforce | read, write, search, webhook |

```bash
construct provider list                          # all providers + health
construct provider add github                    # configure a provider
construct provider test github --query="..."     # round-trip check
construct provider info slack                    # config schema + capabilities
```

Custom providers plug in by exporting a factory that satisfies the provider contract. See `docs/providers/authoring.md` and the reference implementation at `examples/provider-plugin/`.

## 🛠️ Core commands

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
| `construct skills` | Detect project tech stack and scope installed skills to relevance |
| `construct validate` | Validate registry.json structure and field constraints |
| `construct version` | Show version |
<!-- /AUTO:commands -->

Use `construct version` to see the installed version.

## 📊 Health and visibility

`construct status` is the main health surface. It reports what matters now:

- runtime health
- configured providers and their circuit-breaker state
- managed dashboard status
- recent telemetry richness
- session usage signals when available
- project context visibility
- context/alignment public health in machine-readable form
- storage mode visibility for file-state, SQL-ready, and vector-ready layers

```bash
construct status --json
```

The JSON output includes a `publicHealth` block:

- `context` (`hasFile`, `source`, `savedAt`, `summary`)
- `coordination` (`authority`, `fileOwnershipRule`, `memoryRole`)
- `metadataPresence` (`executionContractModel`, `contextState`)
- `storage` — `sql` and `vector` modes, configured status, shared readiness, fallback availability

`construct setup --yes` writes managed defaults for local semantic retrieval, starts a localhost-only Postgres+pgvector container when Docker is available, initializes the schema, and performs an initial file-state sync. If `DATABASE_URL` is already configured, Construct uses that instead. Declining Postgres degrades to a local JSON vector index — Construct stays functional.

`construct up` is runtime hydration, not source of truth. It starts or reuses helpers such as the dashboard, memory server, Postgres, and Langfuse. If optional services are down, Construct recovers from durable state: `plan.md`, `.cx/context.md`, the latest `.cx/handoffs/` file, Beads, docs, git, and `~/.construct/config.env`.

## 🔒 Security

Construct is secure by default when running the dashboard or exposing the MCP HTTP transport:

- **CSRF** — every state-mutating endpoint requires a `X-Construct-CSRF` header matching a per-session double-submit cookie
- **CORS** — `CONSTRUCT_DASHBOARD_ORIGINS` allowlist; SSE endpoints honour the same list
- **Rate limiting** — token-bucket per IP: 60 req/min read, 10 req/min chat stream, 5 req/min mutations
- **Structured logging** — JSON-line logger on stderr with `ts`, `level`, `req_id`, `route`, `actor`, `latency_ms`
- **Multi-token auth** — `construct dashboard tokens issue|list|revoke` with per-token roles (`admin`, `operator`, `viewer`)

See `docs/security.md` for credential handling, audit trail details, and secret rotation guidance.

## 💾 Backup and restore

```bash
construct backup create                # timestamped archive of all state
construct backup verify <archive>      # check SHA-256 manifest without writing
construct backup restore <archive>     # restore to a target HOME
construct backup list                  # show available archives
```

Archives cover observations, sessions, `config.env` (secrets redacted by default), the active registry snapshot, and a Postgres dump when Postgres is configured. Pass `--include-secrets` to include raw credentials. See `docs/operations/backup-restore.md`.

## 📡 Embed daemon supervision

The embed daemon runs continuous background monitoring. To keep it running across reboots and crashes:

```bash
construct embed supervise      # install platform-native supervisor
construct embed unsupervise    # remove the supervisor
construct embed status         # last restart time + restart count
```

Platform support: launchd on macOS, systemd on Linux, Task Scheduler on Windows.

## 🤖 Bring your own models

Construct is provider-agnostic by design.

You can use:

- Anthropic directly
- OpenRouter
- Ollama
- any other OpenAI-compatible endpoint

Set models through environment config, then resync:

```bash
construct sync
```

Construct uses three execution tiers — `reasoning`, `standard`, `fast` — and can infer sibling tiers intelligently, including optional free-model bias to optimize cost without hand-tuning every tier.

## 🔭 Observability

Construct uses Langfuse for agent observability:

- agent trace creation
- runtime session telemetry
- telemetry richness reporting in `construct status` and the dashboard
- sparse trace backfill
- LLM-as-a-judge evals
- performance reviews

Run `construct setup --yes` to start a local Langfuse instance via Docker, or point to a self-hosted instance by setting `LANGFUSE_BASEURL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` in `~/.construct/config.env`.

## 🧠 Memory across sessions

Construct uses a shared observation store so work carries across tools and sessions instead of feeling like you're rebooting every hour.

Observations are role-scoped, vectorized for semantic search, and capped for bounded storage. Session artifacts are distilled automatically at session end — summaries, decisions, open questions, and changed files. Full transcripts are ephemeral.

This is especially useful when moving between OpenCode, Claude Code, and other surfaces.

## ☁️ Self-host on AWS

Construct ships Terraform modules for AWS under `deploy/terraform/`:

- ECS/Fargate with ≥ 2 tasks, ALB sticky sessions, CPU + request-count auto-scaling
- RDS Postgres with pgvector enabled via parameter group (`shared_preload_libraries = 'vector'`)
- AWS Secrets Manager for API keys and dashboard tokens
- CloudWatch log shipping with alarms on CPU, 5xx rate, and p99 latency
- Multi-stage hardened Dockerfile: builder stage (npm ci + global tools), runtime stage (node + git + curl only, no bash, `--read-only` rootfs support)

```bash
cd deploy/terraform
terraform init
terraform apply \
  -var="name=construct" \
  -var="image_uri=ghcr.io/geraldmaron/construct:1.0.0" \
  -var="dashboard_token=<your-token>"
```

See `docs/deploy/aws.md` for the full walkthrough.

## 🤝 For contributors

This repo is the source of truth for Construct itself.

To build from source:

```bash
git clone https://github.com/geraldmaron/construct.git
cd construct
npm install && npm install -g .
construct setup
```

After pulling updates, run the full maintenance cycle:

```bash
git pull
npm install
npm install -g .
construct sync
construct doctor
```

Important files:

- `agents/registry.json` — core registry and routing source of truth
- `bin/construct` — CLI entrypoint
- `lib/` — runtime, hooks, MCP, status, setup, providers, security, and orchestration logic
- `lib/providers/` — provider contract, registry, and built-in implementations
- `lib/server/` — dashboard HTTP server and security middleware
- `lib/bootstrap/` — resource probe registry and lazy install
- `lib/embed/` — embed daemon and platform supervision
- `lib/storage/` — hybrid storage, backup, vector index
- `examples/` — offline prompt fixtures, reference provider plugin
- `personas/` — the public Construct persona
- `agents/prompts/` — internal specialist prompts routed through Construct
- `skills/roles/` — reusable role overlays and anti-pattern guidance
- `skills/` — reusable execution knowledge
- `rules/` — coding and quality guidance
- `deploy/` — Terraform modules, Dockerfile, smoke test workflow

Useful contributor commands:

```bash
npm test
node ./bin/construct update
node ./bin/construct doctor
node ./bin/construct status
node ./bin/construct sync
node ./bin/construct init
node ./bin/construct init-docs
node ./bin/construct docs:update
```

Core repo rule:

- treat `AGENTS.md`, `.cx/context.*`, `docs/README.md`, and `docs/architecture.md` as shared project state
- `plan.md` is a local working document — gitignored, not committed; use it for the current session's plan and the tracker (Beads) for durable work
- all LLMs working here, including Construct, should read these at session start
- if work changes project reality, update the affected core document before calling the work done

## 📁 Project structure

<!-- AUTO:structure -->
```text
construct/
├── agents           Registry and generated platform adapter chains
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

## 🗑️ Uninstall

```bash
npm uninstall -g @geraldmaron/construct
```

If you installed from source, remove the checkout manually.

Optional local cleanup:

```bash
rm -rf ~/.construct ~/.cx/performance-reviews
```

## License

[Elastic License 2.0](LICENSE) — free to use, self-host, and modify. You may not offer Construct as a hosted or managed service to third parties.
