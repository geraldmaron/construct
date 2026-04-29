# Construct Architecture

> Required project state. All LLMs working in this repo, including Construct, should treat this as canonical architecture context and keep it current.

## System overview

Construct is an org-in-a-box: an AI orchestration system that can be pointed at external systems (repos, project trackers, messaging, knowledge bases), embedded as a continuous monitor, and deployed locally or to the cloud. It produces organizational intelligence — PRDs, RFCs, ADRs, health snapshots, recommendations — and manages work across connected systems through a transport-agnostic provider abstraction.

## Architecture layers

```
core/         — CLI, MCP server, orchestration, memory, sessions
providers/    — abstract provider interface + per-system implementations
runtime/      — Docker management, embed daemon, scheduler
dashboard/    — full web app: auth, chat, approvals, config
deploy/       — Dockerfile, Terraform modules, cloud configs
```

### Core

The foundation. Handles orchestration, specialist dispatch, memory, sessions, and the MCP server. Zero external npm dependencies.

- **CLI surface** — `bin/construct` and `lib/cli-commands.mjs`
- **MCP server** — `lib/mcp/server.mjs`, tools split across `lib/mcp/tools/`
- **Orchestration policy** — `lib/orchestration-policy.mjs` (intent classification, execution track selection, gate evaluation, contract-chain resolution)
- **Agent contracts** — `agents/contracts.json` and `lib/agent-contracts.mjs` (producer→consumer service contracts with preconditions, postconditions, input/output schemas)
- **Observation store** — `.cx/observations/` (role-scoped, vectorized, capped insights for continuous learning)
- **Session persistence** — `lib/session-store.mjs`, `.cx/sessions/` (distilled session records for resumption)
- **Hybrid search** — `lib/storage/` (file-state source, SQL store, vector index, hybrid query facade)
- **Hooks / enforcement** — `lib/hooks/` (session-start, bash-output-logger, repeated-read-guard, context-watch, audit-trail)
- **Audit trail** — `lib/audit-trail.mjs`, `~/.cx/audit-trail.jsonl` with tamper-evidence chain
- **Doc stamps** — UUIDv7 front-matter on all generated `.md` files for identity, provenance, and tamper detection

### Providers

Transport-agnostic interface to external systems. Each provider implements a capability matrix and chooses its own transport (MCP, REST, GraphQL, SDK, CLI, webhooks). Core dispatches through the interface — it never knows the transport.

**Capability matrix:**

| Capability | Description |
|---|---|
| `read` | Fetch items, pages, messages, files from the external system |
| `write` | Create or update items (work items, messages, pages, PRs) |
| `search` | Query the external system's index |
| `watch` | Poll or subscribe for changes |
| `webhook` | Receive inbound events from the external system |

**Provider contract:**
- Providers are stateless adapters. Durable state lives in core stores.
- Auth is per-provider, configured in `.cx/providers.yaml` or environment.
- A provider may support any subset of capabilities; unsupported capabilities return a typed error.
- Provider implementations live in `providers/` with one directory per system.

**Planned initial providers:**

| Provider | Transport | Capabilities |
|---|---|---|
| Git repo | git CLI | read, write, watch |
| Project tracker (Jira, Linear) | MCP / REST | read, write, search, webhook |
| Messaging (Slack, Discord) | REST / SDK | read, write, watch, webhook |
| Code host (GitHub, GitLab) | CLI / REST | read, write, search, webhook |
| Knowledge base (Confluence, Notion) | MCP / REST | read, write, search |

### Runtime

Docker service management, embed daemon, and scheduler.

- **Service manager** — `lib/service-manager.mjs` (container lifecycle for Postgres, Langfuse, memory)
- **Embed daemon** — scheduled or long-running process that monitors sources through providers, produces snapshots, manages approval queue
- **Scheduler** — cron-style or interval-based execution (local: in-process schedule; cloud: cron + webhook triggers)

### Dashboard

Full web application replacing the minimal status page.

- Auth (OAuth2 / JWT, multi-user, role-based)
- Chat interface (interact with Construct)
- Approval queue (approve/reject high-risk actions)
- Config management (providers, embed settings, approval rules)
- Snapshot viewer (health reports, risk analysis, recommendations)
- Real-time updates (WebSocket/SSE)
- Mode-aware layout (init, embed, point-at)

### Deploy

Infrastructure as code and container packaging.

- **Dockerfile** — single image with core, providers, dashboard, runtime (< 500 MB target)
- **Terraform modules** — `deploy/terraform/` (VPC, ECS/Fargate, RDS, secrets, DNS, IAM)
- Multi-user auth layer
- Webhook ingestion endpoint for provider events

## Operating model: gates + contracts + specialists

Every request flows through three structural layers:

1. **Gates** (`routeRequest` returns `framingChallenge`, `externalResearch`, `docAuthoring`): preconditions that must hold before work begins. Frame the problem independent of tickets; route authorship to the owning specialist; cx-researcher returns primary sources first.
2. **Contract chain** (`routeRequest.contractChain`): ordered typed handoffs from `agents/contracts.json`. Each contract names a producer→consumer pair, required input fields, preconditions, expected output shape, and postconditions.
3. **Specialist sequence**: dispatch plan with ordering and parallel markers. Gate-required specialists (cx-devil-advocate, cx-researcher, doc owner) are auto-prepended.

## Modes of operation

| Mode | Description | Trigger |
|---|---|---|
| **Point-at** | Accept a target URI, produce analysis or artifact (PRD, RFC, ADR) | `construct analyze <uri>` |
| **Init** | Bootstrap a project with .cx/, shared memory, cross-agent configs | `construct init` |
| **Embed** | Continuous monitoring, snapshot production, work item management | `construct embed start` |
| **Self-host** | Construct manages its own development (this repo) | Always active in the construct repo |

## Project-state hierarchy

One source of truth per concern:

1. External tracker owns the durable backlog and issue lifecycle.
2. `plan.md` owns the current human-readable plan, linked to tracker ids.
3. Memory (observation store via MCP) stores cross-session knowledge, not task state.
4. Single-writer rule: one active writer per file; others review, research, or wait.

## Approval model

Hybrid: autonomous for low-risk, human-gated for high-risk.

| Risk | Examples | Behavior |
|---|---|---|
| Low | Reading, analysis, draft generation, search | Autonomous |
| High | Work item creation, merge, doc publish, config changes | Queued for approval (dashboard or messaging provider) |

## Context hygiene

Enforced via hooks, not advisory text:

- `bash-output-logger` — persists large outputs to disk, nudges grep over re-run
- `repeated-read-guard` — blocks redundant broad re-reads
- `context-watch` — compaction guidance at 60%/80% of resolved context window
- Role skills loaded on demand via `get_skill`

## Session persistence

Distilled, not raw. Sessions store summary, decisions, files changed, open questions, and task snapshot. Full transcripts are ephemeral.

**Tiered injection at session start:**

| Tier | Behavior | Examples |
|---|---|---|
| 1 | Always injected | header, branch, status, approval reminder |
| 2 | When fresh and meaningful | context.md, skill-scope warnings, last-session resume |
| 3 | Hint pointing at MCP tool | prior observations → `memory_recent` |

## Learning loop

Observations (patterns, decisions, anti-patterns) are recorded per-role, vectorized for semantic search, and capped for bounded storage. Entities track recurring components, services, and dependencies. Session artifacts are captured automatically at session end.

## Doc auditability stamps

Every generated `.md` file carries UUIDv7 front-matter:

```yaml
---
cx_doc_id:   019dbb90-...          # UUIDv7, preserved across re-stamps
created_at:  2026-04-23T18:18:12Z  # Set at creation, never mutated
updated_at:  2026-04-23T19:00:00Z  # Updated on every re-stamp
generator:   construct/sync-agents # Which surface produced the file
body_hash:   sha256:<hex>          # SHA-256 of trimmed body
---
```

## Managed artifact directories

| Directory | Contents | Owner |
|---|---|---|
| `docs/prd/` | Product requirements documents | cx-product-manager |
| `docs/adr/` | Architecture decision records | cx-architect |
| `docs/rfc/` | Requests for comment | Varies by topic |

## Key invariants

- Construct is the only public surface. Specialists are implementation details.
- Provider implementations never leak transport details into core.
- External tracker state is canonical for durable work when present.
- Single-writer rule governs parallel editing.
- Mutations are traceable via audit trail with tamper-evidence chain.
- Domain overlays must not auto-promote into permanent capabilities.

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
