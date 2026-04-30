<!--
docs/getting-started.md — Construct onboarding guide.

Covers installation, first-session setup, the memory layer payoff timeline,
and the bootstrap command to accelerate cold-start recall.
-->

# Getting Started with Construct

## Installation

```bash
git clone https://github.com/your-org/construct ~/.construct
~/.construct/install.sh
```

After install, `construct doctor` confirms the system is healthy.

## First Session

Open a project and start your AI coding session. Construct injects context at session start automatically via hooks. The session-start output includes:

- **Working branch** — confirmed before any mutating operation
- **Workflow status** — active task key and acceptance criteria
- **Prior observations** — relevant patterns and decisions from previous sessions

## Memory Layer

Construct's memory layer uses cass-memory behind the standard MCP `memory` surface. It records observations, patterns, and decisions across sessions without becoming a second task tracker. Retrieval uses a BM25 + cosine hybrid search.

### Payoff Timeline

| Sessions | What to expect |
|---|---|
| 0 | Retrieval is cold. Seed corpus provides baseline recall if bootstrapped. |
| 5 | Personal patterns start surfacing alongside seed corpus entries. |
| 20 | Personal patterns dominate. Retrieval is meaningfully better than cold. |
| 50+ | Retrieval is fully personalized. Seed corpus rarely surfaces. |

### Cold-Start Acceleration

Run once after install to import the seed corpus of common patterns, anti-patterns, and architectural decisions:

```bash
construct bootstrap
```

This gives the retrieval layer a meaningful signal immediately, without waiting for 20 sessions of real data.

### Measuring Value

```bash
construct memory stats
```

Reports:
- Sessions tracked
- Average observations injected per session
- Hit rate (sessions where at least one observation was injected)
- p95 retrieval latency

If hit rate is below 30% after 20+ sessions, check that observations are being recorded. Run `construct search "any keyword"` to verify the store has content.

### Disabling Memory Injection

Set `CONSTRUCT_MEMORY=off` to disable memory injection for a session. Useful for A/B comparison or debugging. Stats are still recorded with `memoryEnabled: false` so you can compare outcome quality.

```bash
CONSTRUCT_MEMORY=off claude  # or opencode, etc.
```

## Key Commands

### Services

| Command | Description |
|---|---|
| `construct up` | Start memory and dashboard services |
| `construct down` | Stop all running services |
| `construct status` | Canonical health check across runtime and integrations |
| `construct serve` | Start the dashboard (auto-selects port) |
| `construct doctor` | Verify installation health |

### Setup and Sync

| Command | Description |
|---|---|
| `construct setup` | Bootstrap user config after install |
| `construct update` | Reinstall globally, sync, and verify hosts |
| `construct sync` | Regenerate agent adapter files for all platforms |
| `construct init` | Bootstrap Construct project state without overwriting repo rules |
| `construct init-docs` | Stand up doc lanes and starter templates |

### Work and Knowledge

| Command | Description |
|---|---|
| `construct bootstrap` | Import seed observation corpus for cold-start acceleration |
| `construct memory stats` | Show memory layer usage stats |
| `construct search <query>` | Hybrid search over observations, docs, and snapshots |
| `construct ask "<question>"` | RAG query over the knowledge base |
| `construct knowledge trends` | Recurring patterns in stored observations |
| `construct knowledge index` | Rebuild the knowledge index |
| `construct ingest <path>` | Convert documents into indexed knowledge artifacts |
| `construct drop` | Ingest the most recently dropped file from Downloads/Desktop |
| `construct distill <dir>` | Query-focused document summarisation |
| `construct infer <file>` | Infer a structured field schema from documents |
| `construct wireframe "<desc>"` | Generate a low-fi wireframe (Mermaid or HTML) |
| `construct storage` | Inspect hybrid storage backend status |
| `construct headhunt` | Create a domain expertise overlay |
| `construct reflect` | Capture session feedback and update Construct core |

### Models and Integrations

| Command | Description |
|---|---|
| `construct models` | Show current model tier assignments |
| `construct models --apply` | Apply tier changes to all host configs |
| `construct mcp` | Manage MCP integrations |
| `construct plugin` | Manage external plugin manifests |
| `construct hosts` | Show host support for Construct orchestration |

### Observability (requires Langfuse)

| Command | Description |
|---|---|
| `construct review` | Agent performance report from Langfuse traces |
| `construct optimize <agent>` | Prompt optimisation using quality scores |
| `construct cost` | Token usage, cost, and cache read rate |
| `construct efficiency` | Read efficiency and context-budget guidance |
| `construct eval-datasets` | Sync scored traces into eval datasets |

### Docs

| Command | Description |
|---|---|
| `construct docs:update` | Regenerate AUTO-managed regions in README and docs/ |
| `construct docs:update --check` | CI check — exits non-zero if docs are stale |
| `construct docs:check` | Report commands with no linked how-to guide |
| `construct lint:comments` | Check comment policy violations |
| `construct lint:comments --fix` | Insert stub headers for files missing one |

### Diagnostics

| Command | Description |
|---|---|
| `construct audit trail` | Append-only mutation trail |
| `construct audit skills` | Audit skill files for broken references |
| `construct doc verify <path>` | Verify auditability stamps on markdown files |
| `construct diff` | Show which agents changed prompts since HEAD |
| `construct version` | Show installed version |

## Comment Policy

All files under `lib/`, `bin/`, and test files follow the comment policy in `rules/common/comments.md`. The key rule: comments explain **why** non-obvious decisions were made. They don't narrate execution or restate what the code says. The PostToolUse `comment-lint.mjs` hook flags violations at authoring time.

## Workflow

Construct does not need to own your durable backlog. The intended hierarchy is:

- external tracker, preferably Beads (`bd`), for durable tasks and issue ids
- `plan.md` for the current human-readable implementation plan
- cass-memory via MCP `memory` for cross-session recall

Keep `plan.md`, `.cx/context.*`, and docs current, and prune stale sections when work changes direction.

When multiple agent or harness sessions run at the same time, use the single-writer rule:
- one session owns a file edit
- other sessions review, research, test, or wait for handoff
- do not normalize concurrent same-file editing
