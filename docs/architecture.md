# Construct Architecture

> Required project state. All LLMs working in this repo, including Construct, should treat this as canonical architecture context and keep it current.

## System overview

Construct is a production-oriented orchestration CLI that keeps a stable public surface while routing work through internal specialists, workflows, hooks, MCP integrations, and optional observability/runtime services.

## Core layers

- **CLI surface** — `bin/construct` and `lib/cli-commands.mjs`
- **Workflow state** — `.cx/workflow.json` and `lib/workflow-state.mjs`
- **Domain overlays** — `.cx/domain-overlays/` and `.cx/promotion-requests/` managed by `lib/headhunt.mjs`
- **Retrieval / distillation** — `lib/distill.mjs`
- **Hybrid search layer** — `lib/storage/` (file-state source, SQL-ready store, vector-ready index, hybrid query facade)
- **Runtime health** — `lib/status.mjs`, dashboard API/UI in `lib/server/`
- **MCP integrations** — `lib/mcp-manager.mjs`, `lib/mcp/server.mjs`, `lib/mcp-catalog.json`
- **Hooks / enforcement** — `lib/hooks/`

## Key invariants

- Construct is the only public surface.
- Internal specialists remain implementation details.
- Temporary domain overlays must not auto-promote into permanent capabilities.
- Persistent capability changes require challenge by `cx-devil-advocate`.
- Runtime health, workflow state, overlays, and promotion requests should remain visible in status/dashboard surfaces.

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
