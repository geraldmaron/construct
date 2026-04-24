# Construct

🏢 An org in a box.

You say what needs to happen. Construct figures out who handles it, coordinates the work across the right roles, and holds the team accountable until it’s done.

You don’t manage the handoffs. You don’t direct the agents. You don’t watch the pipeline. You just set the outcome and trust the org to deliver — the same way you’d trust a real team.

Works with Anthropic, OpenRouter, Ollama, and other OpenAI-compatible setups.

## 💡 The idea

A real organization doesn’t need its founder to coordinate every interaction between design, engineering, QA, and product. Each role knows its job, challenges the others where it sees a gap, and the system self-corrects.

Construct works the same way.

Under the hood it runs a full specialist team: architects, engineers, designers, reviewers, security, QA, product managers, data analysts, SREs, and more. Each one has domain expertise and a mandate to push back on work that isn’t ready.

You don’t configure any of this. You give Construct a goal and it routes, coordinates, verifies, and ships.

## ✨ What you get

- **Outcome-driven work** — tell it what you want, not which agent to call
- **A team that challenges itself** — reviewers, security, and QA are peers, not rubber stamps
- **Workflow state** that persists across sessions and surfaces
- **Health and visibility** instead of guesswork about what’s running
- **Telemetry and performance reviews** when you want observability
- **Cross-tool memory** so work carries across Claude Code, OpenCode, and other surfaces
- **Hybrid retrieval** over file-state, SQL-ready records, and semantic search
- **Shared storage setup** that can initialize Postgres and sync core state during `construct setup`

## 📦 Install

### npm

```bash
npm install -g @geraldmaron/construct
construct setup
```

If you pulled a newer Construct checkout from Git and want the device-level CLI and synced host adapters to match that checkout, run:

```bash
construct update
```

## 🚀 Quick start

`construct setup` bootstraps everything — config, local services, and storage. Once it's done:

```bash
construct status   # runtime health
construct doctor   # installation checks
```

After updating this repo from remote, `construct update` is the maintenance path: it reinstalls the current checkout globally, refreshes host adapters without rewriting repo docs, and finishes with `construct doctor`.

To initialize a repo for ongoing LLM-assisted work:

```bash
construct init-docs
```

That creates the core document set Construct expects all LLMs to keep current:

- `.cx/context.md`
- `.cx/context.json`
- `.cx/workflow.json`
- `docs/README.md`
- `docs/architecture.md`

For raw source material such as PDFs, spreadsheets, slide decks, and exports, ingest them into retrieval-ready markdown:

```bash
construct ingest ./vendor-drop --sync
construct ingest ./briefing.pdf --target=sibling
```

By default, ingested markdown lands under `.cx/product-intel/sources/ingested/`, which keeps it in Construct's file-state retrieval path and ready for later hybrid search.

## ⚙️ How it works

Give it a goal. The org handles the rest.

```text
@construct build the customer portal and ship it when it's verified
@construct fix the login redirect bug
@construct review the payment flow before release
@construct explain how the caching layer works
```

Construct routes the work, tracks state, verifies outcomes, and follows through.

The team challenges itself along the way — reviewers push back on incomplete work, security flags risky patterns, QA confirms it actually works. You don’t coordinate any of that. You just get the result.

## 🛠️ Core commands

<!-- AUTO:commands -->
### Services

| Command | What it does |
|---|---|
| `construct up` | Start services (memory, dashboard) |
| `construct down` | Stop all running services |
| `construct status` | Show canonical system health across runtime and integrations |
| `construct show` | Show runtime service URLs and live status (compat view) |
| `construct serve` | Start the Construct dashboard (auto-selects port) |
| `construct setup` | Bootstrap user config after npm or manual install |
| `construct update` | Reinstall this checkout globally, then sync and verify hosts |

### Agents & Sync

| Command | What it does |
|---|---|
| `construct sync` | Generate agent adapters for all platforms |
| `construct list` | Show all personas and specialist agents |

### Work

| Command | What it does |
|---|---|
| `construct distill` | Distill documents with query-focused, citation-ready chunk selection |
| `construct ingest` | Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts |
| `construct infer` | Infer a structured field schema from one or more documents using AI |
| `construct search` | Run hybrid file, SQL, and semantic retrieval over core project state |
| `construct storage` | Sync and inspect the hybrid storage backend |
| `construct headhunt` | Create a temporary domain expertise overlay or promotion request |
| `construct workflow` | Manage .cx/workflow.json orchestration state |
| `construct init-docs` | Generate AI-tailored doc structure for the current project |
| `construct team` | Team review and template listing |
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct memory` | Inspect memory layer usage statistics |
| `construct drop` | Ingest the most recent file dropped into ~/Downloads, Desktop, Documents, or iCloud Drive |
| `construct wireframe` | Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description |

### Models & Integrations

| Command | What it does |
|---|---|
| `construct models` | Show or update model tier assignments |
| `construct mcp` | Manage MCP integrations |
| `construct plugin` | Manage external Construct plugin manifests |
| `construct hosts` | Show host support for Construct orchestration |

### Observability

| Command | What it does |
|---|---|
| `construct review` | Generate agent performance review from Langfuse trace backend |
| `construct optimize` | Prompt optimization using Langfuse trace quality scores |
| `construct telemetry-backfill` | Backfill sparse traces with observations (trace backend) |
| `construct cost` | Show token usage, cost, cache read rate, and per-agent breakdown |
| `construct efficiency` | Show read efficiency, repeated files, and context-budget guidance |
| `construct evals` | Show evaluator catalog for prompt and agent experiments |

### Docs

| Command | What it does |
|---|---|
| `construct docs:update` | Regenerate AUTO-managed regions in README and docs/ |
| `construct docs:site` | Generate site/docs/ content for the MkDocs GitHub Pages site |
| `construct lint:comments` | Check all files against the comment policy (rules/common/comments.md) |
| `construct lint:research` | Check research and evidence artifacts for minimum structure and evidence metadata |

### Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct skills` | Detect project tech stack and scope installed skills to relevance |
| `construct doctor` | Run installation health checks |
| `construct validate` | Validate registry.json structure and field constraints |
| `construct diff` | Show which agents changed prompts or settings since HEAD |
| `construct version` | Show version |
<!-- /AUTO:commands -->

Use `construct version` to see the installed version.

## 📊 Built for real usage

`construct status` is the main health surface.

It reports what matters now:

- runtime health
- configured integrations
- managed dashboard status
- recent telemetry richness
- session usage signals when available
- current workflow/task visibility
- context/workflow public health in machine-readable form
- storage mode visibility for file-state, SQL-ready, and vector-ready layers

If you want the raw machine-readable payload:

```bash
construct status --json
```

The JSON output includes a shared `publicHealth` block. Today that block exposes:

- `activeTask`
- `context` (`hasFile`, `source`, `savedAt`, `summary`)
- `workflow` (`exists`, `phase`, `lifecycleStatus`, `currentTaskKey`, `summary`)
- `alignment` (`status`, `findings`, counts)
- `metadataPresence` (`executionContractModel`, `contextState`)

Hybrid storage readiness is also reported via `storage`:

- `sql` (`mode`, `configured`, `sharedReady`, `fallbackAvailable`)
- `vector` (`mode`, `configured`, `sharedReady`, `fallbackAvailable`)
- `health` (`sql`, `vector`)

`construct setup --yes` writes managed defaults for local semantic retrieval, starts a localhost-only Postgres container when Docker is running, initializes the schema, and performs an initial file-state sync. If `DATABASE_URL` is already configured, Construct uses that instead of starting managed Postgres.

The status JSON also reports hybrid storage readiness so team-ready deployments can see whether SQL/vector stores are configured or still running file-only. Tracing becomes active once `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present in `~/.construct/config.env` or `.env`.

The same public-health contract is exposed through the Construct MCP server on:

- `project_context`
- `workflow_status`

The shared contract is strongest around active task, workflow/alignment state, and metadata presence. `project_context` is the MCP surface that also carries the resolved project context payload itself.

## 🤖 Bring your own models

Construct is provider-agnostic by design.

You can use:

- Anthropic directly
- OpenRouter
- Ollama
- other compatible endpoints

Set models through environment config, then resync:

```bash
construct sync
```

Construct uses three execution tiers:

- `reasoning`
- `standard`
- `fast`

It can also infer sibling tiers more intelligently, including optional free-model bias when you want to optimize cost without hand-tuning every tier.

## 🔭 Observability when you want it

Construct uses Langfuse for agent observability.

It supports:

- agent trace creation
- runtime session telemetry
- telemetry richness reporting in status/dashboard
- sparse trace backfill
- performance reviews

Run `construct setup --yes` to start a local Langfuse instance via Docker, or point to a self-hosted instance by setting `LANGFUSE_BASEURL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` in `~/.construct/config.env`.


## 🧠 Memory across sessions

Construct can use shared memory so work carries across tools and sessions instead of feeling like you’re rebooting your brain every hour.

That is especially useful if you move between OpenCode, Claude Code, and other surfaces.

## 🤝 For contributors

This repo is the source of truth for Construct itself.

To build from source:

```bash
git clone https://github.com/geraldmaron/construct.git
cd construct
npm install && npm install -g .
construct setup
```

Important files:

- `agents/registry.json` — core registry and routing source of truth
- `bin/construct` — CLI entrypoint
- `lib/` — runtime, hooks, MCP, status, setup, and orchestration logic
- `examples/` — offline prompt example fixtures for regression and evals
- `personas/` — the public Construct persona
- `agents/prompts/` — internal specialist prompts routed through Construct
- `skills/roles/` — internal reusable role overlays and anti-pattern guidance
- `skills/` — reusable execution knowledge
- `rules/` — coding and quality guidance

Useful contributor commands:

```bash
npm test
node ./bin/construct update
node ./bin/construct doctor
node ./bin/construct status
node ./bin/construct sync
node ./bin/construct init-docs
node ./bin/construct docs:update
```

Core repo rule:

- treat `.cx/context.*`, `.cx/workflow.json`, `docs/README.md`, and `docs/architecture.md` as shared project state
- all LLMs working here, including Construct, should read them at session start
- if work changes project reality, update the affected core document before calling the work done

## Where this is going

Construct is moving toward a package-manager-first, cross-platform setup flow that feels more like a product and less like infra cosplay.

That means:

- `construct setup` is the primary bootstrap path
- `construct status` is the canonical health surface
- runtime and telemetry are getting more explicit and less magical
- public docs present Construct as the product, not a maze of internals

## 📁 Project structure

<!-- AUTO:structure -->
```text
construct/
├── agents           Registry and generated platform adapter chains
├── bin              CLI entrypoint (`construct`)
├── commands         Command prompt assets
├── db
├── docs             Architecture notes, runbooks, and documentation contract
├── examples
├── langfuse         Langfuse trace backend for agent observability
├── lib              Core runtime: CLI, hooks, MCP, status, sync, workflow
├── personas         Persona prompt definitions
├── platforms
├── rules            Coding and quality standards
├── schemas
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
