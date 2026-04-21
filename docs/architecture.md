# Construct Architecture

> Required project state. All LLMs working in this repo, including Construct, should treat this as canonical architecture context and keep it current.

## System overview

Construct is a production-oriented orchestration CLI that keeps a stable public surface while routing work through internal specialists, workflows, hooks, MCP integrations, and optional observability/runtime services.

## Core layers

- **CLI surface** — `bin/construct` and `lib/cli-commands.mjs`
- **Workflow state** — `.cx/workflow.json` and `lib/workflow-state.mjs`
- **Orchestration policy** — `lib/orchestration-policy.mjs` (intent classification, work-category tagging, execution track selection, gate evaluation, contract-chain resolution)
- **Agent contracts** — `agents/contracts.json` and `lib/agent-contracts.mjs` (explicit producer→consumer service contracts with preconditions, postconditions, input/output schemas)
- **Doc ownership, framing, and skill-composition rules** — `rules/common/{doc-ownership,framing,skill-composition}.md`
- **Project profile and skill scoping** — `lib/project-profile.mjs`, `lib/skills-scope.mjs`, `lib/skills-apply.mjs`
- **Domain overlays** — `.cx/domain-overlays/` and `.cx/promotion-requests/` managed by `lib/headhunt.mjs`
- **Retrieval / distillation** — `lib/distill.mjs`
- **Hybrid search layer** — `lib/storage/` (file-state source, SQL-ready store, vector-ready index, hybrid query facade)
- **Runtime health** — `lib/status.mjs`, dashboard API/UI in `lib/server/`
- **MCP integrations** — `lib/mcp-manager.mjs`, `lib/mcp/server.mjs`, `lib/mcp-catalog.json`
- **Hooks / enforcement** — `lib/hooks/` (session-start, bash-output-logger, repeated-read-guard, context-watch, audit-trail, and more)
- **Audit trail** — `lib/hooks/audit-trail.mjs`, `lib/audit-trail.mjs`, `~/.cx/audit-trail.jsonl` with `prev_line_hash` tamper-evidence chain
- **Session persistence** — `lib/session-store.mjs`, `.cx/sessions/`

## Operating model: gates + contracts + specialists

Every request flows through three structural layers:

1. **Gates** (`routeRequest` returns `framingChallenge`, `externalResearch`, `docAuthoring`): preconditions that must hold before scaffolding begins. Frame the problem independent of tickets; route authorship to the owning specialist; cx-researcher returns primary sources before the drafting specialist proceeds.
2. **Contract chain** (`routeRequest.contractChain`): ordered typed handoffs from `agents/contracts.json`. Each contract names a producer→consumer pair, required input fields, preconditions, expected output shape/schema, and postconditions. Specialists call the `agent_contract` MCP tool at handoff time to introspect what they must receive and what they must return.
3. **Specialist sequence**: dispatch plan with explicit ordering and parallel markers. Gate-required specialists (cx-devil-advocate, cx-researcher, doc owner) are auto-prepended.

Post-DONE, the `any-to-docs-keeper` contract fires as a followup stage when core docs changed.

## Context hygiene

Construct measures context pressure and enforces it via hooks rather than advisory prompt text:

- `bash-output-logger` persists Bash outputs >4KB to `~/.cx/bash-logs/` and nudges the model to grep the log instead of re-running.
- `repeated-read-guard` blocks broad re-reads of files already read twice in the session; narrow-range follow-ups are allowed.
- `context-watch` injects compaction guidance at 120k / 160k token thresholds (overridable via `CONSTRUCT_CONTEXT_WARN` / `CONSTRUCT_CONTEXT_URGENT`).
- Role skills are loaded on demand via `get_skill` rather than preloaded at sync time.
- `sharedGuidance` keeps only 10 essentials per specialist; the 22 reference items live in `skills/operating/orchestration-reference.md` and load on demand.

## Key invariants

- Construct is the only public surface.
- Internal specialists remain implementation details.
- Temporary domain overlays must not auto-promote into permanent capabilities.
- Persistent capability changes require challenge by `cx-devil-advocate`.
- Runtime health, workflow state, overlays, and promotion requests should remain visible in status/dashboard surfaces.
- Agent contracts are the source of truth for producer→consumer expectations. The orchestrator routes; owning specialists author.
- Mutations are traceable: every Edit/Write/MultiEdit/NotebookEdit/mutating-Bash appends to the audit trail with agent + task attribution and a tamper-evident chain.

## Public health contract

Construct exposes one canonical machine-readable health slice for current project state:

- `construct status --json`
- MCP `project_context`
- MCP `workflow_status`

These surfaces share the same runtime-defined `publicHealth` contract for active task, workflow/alignment state, and metadata-presence signals. `project_context` is the richer MCP surface for actual context-source details.

### `publicHealth` fields

- `activeTask`
  - `key`
  - `title`
  - `phase`
  - `owner`
  - `status`
- `context`
  - `hasFile`
  - `source` (`json`, `markdown`, `missing`, `invalid`)
  - `savedAt`
  - `summary`
- `workflow`
  - `exists`
  - `phase`
  - `lifecycleStatus`
  - `currentTaskKey`
  - `summary`
- `alignment`
  - `status`
  - `findings`
  - `findingCount`
  - `highSeverityCount`
- `metadataPresence`
  - `executionContractModel`
  - `contextState`

### Semantics

- `activeTask` comes from `.cx/workflow.json` `currentTaskKey` resolution.
- `project_context.publicHealth.context.source` reflects the actual source Construct loaded from `.cx/context.json` or `.cx/context.md`.
- `workflow_status.publicHealth.context` is currently a workflow-scoped view and should not be treated as the canonical source-of-truth for resolved project context details.
- `alignment` is derived from workflow-alignment checks, not inferred from docs or prompt state.
- `metadataPresence.executionContractModel` means the canonical execution-contract metadata object is available on the surface.
- `metadataPresence.contextState` is true when the active context source is `.cx/context.json`.

The intent is parity, not duplication: status and MCP project/workflow tools should expose the same public truth for active task, workflow alignment, and metadata presence, while `project_context` remains the canonical MCP surface for resolved context-source details.

## Release-facing observability boundary

- `construct status --json` is the canonical public health surface for runtime, workflow, context, and active trace-backend state.
- Construct uses Langfuse as the trace backend for all observability: status health reporting, `construct review`, `construct optimize`, and telemetry backfill.

## Domain overlay lifecycle

1. `construct headhunt <domain>` creates a temporary overlay
2. Overlay is attached to existing specialists as bounded scope guidance
3. Overlay can be promoted into a review request
4. Promotion requires architecture + devil's advocate + docs/ownership review
5. Expired temporary overlays can be cleaned up safely

## Session persistence

Sessions are the durable record of what happened during each interaction. They survive `construct down` and enable effective resumption without re-reading full transcripts.

### Design: distilled, not raw

Sessions store only what matters for resumption:

| Field | Purpose | Cap |
|---|---|---|
| `summary` | 2-3 sentence description of what happened | 500 chars |
| `decisions` | Key architectural/design choices made | 20 items |
| `filesChanged` | Paths + one-line reason | 50 items |
| `openQuestions` | Unresolved issues or blockers | 10 items |
| `taskSnapshot` | Task IDs + status (not full descriptions) | unlimited |

Full conversation transcripts, raw tool outputs, and file contents are NOT stored — they are ephemeral or already on disk.

### Storage layout

- `.cx/sessions/index.json` — lightweight array for fast listing (id, project, status, summary)
- `.cx/sessions/<id>.json` — distilled session record

### Lifecycle

1. **Session start** — `session-start.mjs` hook creates a new session and loads the last completed session for resume context
2. **Mid-session** — agents can call `session_save` MCP tool to persist distilled state
3. **Session end** — `stop-notify.mjs` hook marks the active session as completed with a summary
4. **Construct down** — `closeAllSessions()` marks all active sessions as closed

### MCP tools

- `session_list` — list sessions with optional status/project filter
- `session_load` — load full distilled record + generated resume context
- `session_search` — keyword search across session summaries
- `session_save` — update active session with distilled context

## Learning loop (observation store + entity tracking)

The learning loop enables specialists to accumulate and retrieve knowledge across sessions. Each specialist can record observations (patterns, decisions, anti-patterns) and query them semantically on future runs.

### Design: role-scoped, vectorized, capped

Observations are distilled insights — not raw transcripts. Each observation is scoped to a role and category, vectorized for semantic search, and capped to keep storage bounded.

| Field | Purpose | Cap |
|---|---|---|
| `summary` | One-line description of the insight | 500 chars |
| `content` | Detailed explanation or evidence | 2000 chars |
| `role` | Which specialist recorded this | — |
| `category` | pattern, anti-pattern, dependency, decision, insight, session-summary | — |
| `tags` | Searchable labels | 10 items |
| `confidence` | How certain the observation is | 0.0–1.0 |
| `source` | Session or file that produced it | — |

### Storage layout

- `.cx/observations/index.json` — lightweight listing for fast filtering (id, role, category, summary, createdAt)
- `.cx/observations/<id>.json` — full observation record
- `.cx/observations/vectors.json` — local vector index (256-dim `hashing-bow-v1` embeddings) for semantic search
- `.cx/observations/entities.json` — tracked entities (components, services, dependencies, concepts)

### Entity tracking

Entities represent recurring things specialists encounter — components, services, APIs, dependencies, file groups. Each entity links to observation IDs and related entities, enabling "what do we know about X?" queries.

Caps: 1000 observations, 500 entities, 50 observations per entity, 20 related entities.

### Artifact capture

At session end, `stop-notify.mjs` automatically captures:
1. A `session-summary` observation from the completed session's summary and decisions
2. Individual `decision` observations (capped at 5 per session)
3. `file-group` entities from changed file directory patterns

### MCP tools

- `memory_search` — semantic search over observations with optional role/category/project filters
- `memory_add_observations` — batch-add up to 10 observations per call, auto-sets project from cwd
- `memory_create_entities` — batch-create/update up to 10 entities with observation linking

### Lifecycle

1. **Session start** — `session-start.mjs` surfaces the 5 most recent observations for the project
2. **Mid-session** — specialists call `memory_add_observations` and `memory_create_entities` as they discover patterns
3. **Session end** — `stop-notify.mjs` runs `captureSessionArtifacts()` to auto-record session insights
4. **Next session** — `memory_search` retrieves relevant prior observations for context

## Validation and release expectations

- tests must pass
- docs should reflect shipped behavior
- release/version metadata should be updated intentionally

## Hybrid retrieval model

Construct uses file-state as the canonical source of truth.

- `.cx/context.json`, `.cx/context.md`, `.cx/workflow.json`, and docs are authoritative
- SQL is the shared/team-ready structured store for indexed records and lifecycle data
- vector search is a derived retrieval layer for semantic discovery over selected artifacts

The first implementation slice exposes read-first search and health reporting; write synchronization into shared stores should remain append-only and idempotent when introduced.

### Storage operations

- `construct setup --yes` writes managed vector defaults, starts a localhost-only Postgres container when Docker is available, initializes the shared Postgres schema, and performs an initial sync. Existing `DATABASE_URL` values take precedence.
- `construct storage sync` syncs file-state artifacts into the shared SQL store.
- `construct storage status` reports backend config and reachability.
- `construct search` merges file-state retrieval with any SQL-backed hits available at runtime.

## Agent registry

<!-- AUTO:agents -->
| Agent | Tier | Purpose |
|---|---|---|
| `orchestrator` | — | Sees the whole board — orchestrates by assembling the right perspectives in the  |
| `rd-lead` | — | Slows the team down at the right moment — before architecture locks in assumptio |
| `product-manager` | — | Translates user reality into technical deliverables — skeptical of any requireme |
| `ux-researcher` | — | Brings user reality into the room — guards against assumptions built on internal |
| `operations` | — | The logistics mind who maps dependencies, sequences, and ownership — because hid |
| `researcher` | — | Never trusts recall alone — sources every claim with a primary reference and a d |
| `business-strategist` | — | Asks whether we're building the right thing for the right market at the right ti |
| `data-analyst` | — | Measures carefully because measurement shapes behavior — suspicious of metrics t |
| `evaluator` | — | Defines what 'better' means before the work is done — evaluations designed after |
| `ai-engineer` | — | Designs for failure before designing for success — 'it works in the demo' is the |
| `architect` | — | Makes trade-offs explicit before implementation locks them in — permanently susp |
| `engineer` | — | Reads before writing — understanding the existing pattern matters more than havi |
| `devil-advocate` | — | Makes the plan survive contact with reality — the person who was right about the |
| `reviewer` | — | Finds bugs by looking at the conditions the author didn't test for — happy path  |
| `security` | — | Thinks like an attacker — sees the attack surface the developer didn't know exis |
| `qa` | — | Asks whether the tests test what matters — coverage numbers are hypotheses about |
| `debugger` | — | Traces to root cause before proposing a fix — the real bug is always one layer d |
| `sre` | — | Plans for failure before it happens — reliability problems are designed in, not  |
| `platform-engineer` | — | Reduces the tax on the people doing the work — friction compounds, and platform  |
| `legal-compliance` | — | Catches compliance risk before the architecture locks — legal remediation after  |
| `release-manager` | — | Guards the gap between 'verified' and 'safe to ship' — rollback procedures that  |
| `docs-keeper` | — | Owns the record of why, not just what — undocumented decisions become tribal kno |
| `designer` | — | Treats visual decisions as interaction decisions — a design that only exists in  |
| `accessibility` | — | Tests with a screen reader and keyboard — accessibility is measured by using the |
| `explorer` | — | Reads before concluding — assumptions about code are wrong more often than assum |
| `trace-reviewer` | — | Tracks fleet-level performance patterns — stable median scores can hide high-var |
| `data-engineer` | — | Builds pipelines that can be trusted — trust requires idempotency, observability |
| `test-automation` | — | Knows that bad automation is worse than no automation — flaky tests teach teams  |
<!-- /AUTO:agents -->
