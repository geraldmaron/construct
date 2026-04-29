---
cx_doc_id: 019dc30f-7305-7e13-a0b1-f633ab2a2792
created_at: 2026-04-25T05:14:22.853Z
updated_at: 2026-04-28T00:00:00.000Z
generator: construct/init
body_hash: sha256:placeholder
---
<!--
plan.md — current implementation plan for this repository.

This file is a living plan, not an archive:
- keep it linked to the active tracker issue ids
- update it when scope, sequencing, or acceptance changes
- prune or replace sections once the plan is superseded
-->

# Implementation Plan — Construct: Org-in-a-Box

## Tracker Links

- PRD: `docs/prd/0001-construct-org-in-a-box.md`
- ADR: `docs/adr/0002-layered-architecture.md`
- Primary issue: TBD (will be created as Construct dogfoods)

## Goal

Build Construct as a deployable org-in-a-box: point it at external systems, embed it continuously, manage its own development, and serve multiple users through a web dashboard. External systems are integrated through a transport-agnostic provider interface — MCP, REST, GraphQL, SDK, CLI, webhooks, whatever the system supports.

## Architecture Layers

```
core/         — CLI, MCP server, orchestration, memory, sessions
providers/    — abstract provider interface + per-system implementations
runtime/      — Docker management, embed daemon, scheduler
dashboard/    — full web app: auth, chat, approvals, config
deploy/       — Dockerfile, Terraform modules, cloud configs, multi-user auth
```

---

## Phase 0: Foundation & Self-Hosting (current)

**Goal**: Construct manages its own development. Establish the doc/artifact system, prove dogfooding.

| # | Task | Status | Notes |
|---|---|---|---|
| 0.1 | Write PRD | done | `docs/prd/0001-construct-org-in-a-box.md` |
| 0.2 | Write ADR-0002 (layered architecture) | done | `docs/adr/0002-layered-architecture.md` |
| 0.3 | Write this plan | done | `plan.md` |
| 0.4 | Clean working tree, remove stale artifacts (changelog, etc.) | done | CHANGELOG nuked, .mcp.json gitignored |
| 0.5 | Establish `docs/prd/`, `docs/adr/`, `docs/rfc/` as managed artifact dirs | done | All three dirs exist |
| 0.6 | Verify existing tests pass | done | 87 tests passing |
| 0.7 | Update `docs/architecture.md` with layer model | done | 5-layer model, provider matrix, operating model |

## Phase 1: Core Hardening & Dependency Bootstrap

**Goal**: `construct init` and `construct up` work reliably. Dependency checking. Docker service lifecycle is solid.

| # | Task | Status | Notes |
|---|---|---|---|
| 1.1 | `construct doctor` — check Node, Docker, git, required env; offer install guidance | done | bin/construct cmdDoctor, checks 20+ items |
| 1.2 | `construct init` — detect existing agent configs (Claude, Codex, Copilot), set up .cx/, shared memory, cross-agent configs | done | lib/init.mjs + lib/setup.mjs (full bootstrap) |
| 1.3 | Docker service manager — reliable `up`/`down`/`status` for required containers | done | lib/service-manager.mjs, 497 lines |
| 1.4 | Port probe — verify actual service health before reuse | done | findAvailablePort in host-capabilities.mjs |
| 1.5 | Test coverage for service lifecycle | done | 17 tests passing (doctor + service-manager) |

**Acceptance**: `construct init` in a fresh repo → working setup. `construct up` → services healthy. `construct doctor` → clear report.

## Phase 2: Provider Framework & Initial Implementations

**Goal**: Transport-agnostic provider interface. First providers proving the abstraction works across different transports.

| # | Task | Status | Notes |
|---|---|---|---|
| 2.1 | Provider interface spec — capability matrix (read, write, search, watch, webhook), auth contract, error model | done | ADR-0003, providers/lib/interface.mjs, errors.mjs |
| 2.2 | Provider registry and config schema — `construct.yaml` or `.cx/providers.yaml` | done | providers/lib/registry.mjs |
| 2.3 | Git repo provider — local + remote repos, read commits/branches/files, write via branch+PR | done | providers/git/index.mjs, transport: git CLI |
| 2.4 | Project tracker provider — work items, transitions, search (Jira as first impl) | done | providers/jira/index.mjs, transport: REST API v3 |
| 2.5 | Messaging provider — read channels/threads, post messages (Slack as first impl) | pending | Transport: REST/SDK |
| 2.6 | Code host provider — PRs, issues, reviews, repo metadata (GitHub as first impl) | done | providers/github/index.mjs, transport: gh CLI |
| 2.7 | Knowledge base provider — pages, search, create/update (Confluence/Notion as first impl) | pending | Transport: MCP or REST |
| 2.8 | Provider test harness — contract tests any provider must pass | done | providers/lib/contract-tests.mjs, 35 tests passing |

**Acceptance**: `construct providers list` shows registered providers. `construct providers test <name>` validates the capability contract. At least 3 providers using different transports work end-to-end.

## Phase 3: Embed Mode & Snapshots

**Goal**: Construct runs as a daemon or scheduled process, monitoring sources through providers and producing organizational intelligence.

| # | Task | Status | Notes |
|---|---|---|---|
| 3.1 | Embed config schema — sources (provider refs), intervals, output targets, approval rules | pending | |
| 3.2 | Scheduler — cron-style or interval-based execution loop | pending | Local: schedule. Cloud: cron + webhook |
| 3.3 | Snapshot engine — aggregate data from providers, produce health/risk/gap report | pending | |
| 3.4 | Snapshot output targets — markdown file, messaging provider, dashboard, all configurable | pending | |
| 3.5 | Approval queue — high-risk actions (work item creation, merge, doc publish) go to queue | pending | |
| 3.6 | `construct embed start/stop/status` CLI commands | pending | |
| 3.7 | Artifact generation — PRDs, RFCs, ADRs on demand or triggered by embed analysis | pending | |

**Acceptance**: `construct embed --config embed.yaml` produces a snapshot within configured interval. High-risk actions queue for approval. Snapshots appear in configured targets.

## Phase 4: Dashboard

**Goal**: Full web app. Auth, chat, approvals, config, mode-aware views.

| # | Task | Status | Notes |
|---|---|---|---|
| 4.1 | Tech choice ADR — framework, bundled in container | pending | |
| 4.2 | Auth — OAuth2 or JWT, multi-user, role-based | pending | |
| 4.3 | Dashboard views — overview, embed status, snapshots, approval queue, config editor | pending | |
| 4.4 | Chat interface — interact with Construct through the dashboard | pending | |
| 4.5 | Config management — providers, embed settings, approval rules, all editable in UI | pending | |
| 4.6 | Real-time updates — WebSocket or SSE for live status, new approvals, snapshot alerts | pending | |
| 4.7 | Mode-aware layout — views adapt based on active mode (init, embed, point-at) | pending | |

**Acceptance**: Dashboard serves on `construct up`. Users can log in, see status, chat with Construct, approve/reject actions, edit configs.

## Phase 5: Cloud Deployment & Multi-User

**Goal**: Single-container deployable with multi-user support.

| # | Task | Status | Notes |
|---|---|---|---|
| 5.1 | Dockerfile — single image with core, providers, dashboard, runtime | pending | < 500 MB target |
| 5.2 | Terraform modules — VPC, ECS/Fargate, RDS, secrets, DNS, IAM | pending | `deploy/terraform/` |
| 5.3 | Webhook ingestion — receive events from providers for event-driven embed | pending | |
| 5.4 | Persistent state — mount or managed database for observations, sessions, artifacts | pending | RDS via Terraform |
| 5.5 | Multi-user isolation — user scoping for observations, sessions, configs | pending | |
| 5.6 | Hybrid approval model — autonomous for low-risk, approval-gated for high-risk | pending | |
| 5.7 | Deployment guide — `terraform apply`, env vars, secrets, health checks | pending | Runbook |
| 5.8 | CI/CD — build, test, push image, optional `terraform plan` on PR | pending | |

**Acceptance**: `docker build && docker run` starts a working instance. Multi-user auth works. Webhook events trigger embed actions.

## Phase 6: Continuous Learning & Knowledge Base

**Goal**: RAG over historical decisions, trend detection, queryable knowledge base.

| # | Task | Status | Notes |
|---|---|---|---|
| 6.1 | RAG pipeline — index observations, decisions, artifacts for semantic retrieval | pending | |
| 6.2 | Trend detection — surface recurring patterns, escalating risks, decision drift | pending | |
| 6.3 | Knowledge base queries — "what do we know about X?", "what changed in the last week?" | pending | |
| 6.4 | Dashboard knowledge view — browse and search accumulated intelligence | pending | |

**Acceptance**: `construct ask "what are the biggest risks?"` returns a sourced answer. Dashboard shows knowledge timeline. Trends are surfaced in snapshots.

---

## Decisions

- Layered architecture, not rewrite (ADR-0002).
- Provider interface is transport-agnostic — MCP, REST, GraphQL, SDK, CLI, webhooks are all valid transports. Core never knows the transport.
- Core remains zero-npm-dependency. Providers and dashboard bring their own deps.
- Single-container deployment. Multi-container is a future option.
- Providers are stateless adapters. Durable state lives in core stores.
- Phase 0 (dogfooding) starts immediately. Later phases may overlap.

## Verification

Each phase has its own acceptance criteria above. Cross-cutting:

- Tests pass at every phase boundary
- `docs/architecture.md` reflects current reality after each phase
- Construct's own PRDs/ADRs are managed through the system from Phase 0 onward
- No secrets in observations, logs, or committed files
