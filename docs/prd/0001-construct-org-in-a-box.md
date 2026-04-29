# PRD: Construct — Org-in-a-Box

- **Date**: 2026-04-28
- **Owner**: Gerald Maron
- **Status**: draft

## Problem

Individual developers and small teams working with AI coding agents (Claude, Codex, Copilot) have no unified system that acts as an operational layer across their tools, repos, project management, and communication channels. Each agent session starts cold, knowledge is siloed per tool, and there is no persistent organizational intelligence that accumulates, monitors, produces artifacts (PRDs, RFCs, ADRs), manages work, and surfaces risks. The result is that the human remains the sole integrator across all surfaces, manually shuttling context between tools and making decisions that could be informed by continuous synthesis.

## Users

| Segment | Description | Current workaround |
|---|---|---|
| Solo developer | Uses 2-3 AI agents across repos, needs ops intelligence | Manual context transfer, no persistent memory across tools |
| Small team (2-10) | Shares repos, trackers, messaging; needs aligned ops view | Dedicated ops person or ad-hoc processes |
| Construct itself | The construct repo needs its own org layer (dogfood) | Manual doc maintenance, no continuous monitoring |

## Goals and non-goals

### Goals

- G1: Construct operates as a self-contained "org-in-a-box" that can be pointed at external systems and produce organizational intelligence (PRDs, RFCs, ADRs, snapshots, recommendations).
- G2: `construct init` bootstraps a project with shared memory, agent configs, and structure usable by Claude, Codex, Copilot, and other agent harnesses.
- G3: Embed mode allows Construct to continuously monitor configured sources, manage work items, propose doc changes, and produce periodic health snapshots.
- G4: Construct runs on Construct — the construct repo is the first customer, with its own PRDs, ADRs, and RFCs managed by the system.
- G5: Deployable as a single container with multi-user support and a hybrid approval model (autonomous for low-risk, human approval for high-risk).
- G6: A full web dashboard for configuration, chat interaction, approval queues, and mode-aware views.
- G7: Continuous learning through RAG over historical decisions, trend detection, and a queryable knowledge base.

### Non-goals

- NG1: Replacing specialized external tools — Construct reads from and writes to them, doesn't replace them.
- NG2: Real-time pair-programming or IDE integration — that's the agent harness's job.
- NG3: Fine-tuning or training custom models.
- NG4: Multi-cloud abstraction layer — Terraform handles infra, not a custom cloud SDK.

## Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | **Point-at-things mode**: Accept a target URI (repo, project tracker, messaging channel, document, API endpoint) and produce a structured analysis or artifact (PRD, RFC, ADR, research brief). Target type is resolved by the provider abstraction, not hardcoded. |
| FR-2 | **Init mode**: `construct init` detects existing agent configs, sets up shared memory, cross-agent config files, and project structure (.cx/). Checks for required dependencies and installs or prompts for missing ones. |
| FR-3 | **Embed mode**: Long-running or scheduled process that monitors configured sources through providers, produces periodic snapshots (health, risks, gaps, recommendations), manages work items, proposes doc changes, and posts to configured output channels. |
| FR-4 | **Provider abstraction**: A typed interface that any external system implements. Providers expose a capability matrix (read, write, search, watch, webhook) and Construct dispatches through the interface. The transport is the provider's choice — MCP server, REST API, GraphQL, SDK, CLI, webhook, or any combination. Initial implementations include project trackers (Jira, Linear), messaging (Slack, Discord), code hosts (GitHub, GitLab), knowledge bases (Confluence, Notion), and git repos, but the system accepts any provider that satisfies the interface. Third-party providers are added without modifying core. |
| FR-5 | **Docker service management**: `construct up` spins up required containers for services Construct needs (database, observability, memory). Checks for Docker availability and installs/prompts if missing. |
| FR-6 | **Self-hosting**: Construct manages its own docs, PRDs, ADRs, RFCs. Construct orchestrates its own development (proposes PRs, runs tests, updates plans). |
| FR-7 | **Cloud deployment**: Single-container deployable (Docker image) with multi-user auth, persistent state, and webhook ingestion for embed mode event triggers. Infrastructure provisioned via Terraform (VPC, ECS/Fargate, RDS, secrets, DNS). |
| FR-8 | **Dashboard**: Full web app with auth, real-time updates, chat interface, approval queue, config management, and mode-aware views (init, embed, point-at). |
| FR-9 | **Continuous learning**: RAG over accumulated observations, decisions, and artifacts. Trend detection across sessions. Queryable knowledge base ("what do we know about X?"). |
| FR-10 | **Snapshot generation**: On-demand or scheduled reports summarizing project health, risks, alignment gaps, and actionable recommendations. Output to dashboard, any messaging provider, and/or markdown. |
| FR-11 | **Hybrid approval model**: Low-risk actions (reading, analysis, draft generation) are autonomous. High-risk actions (work item creation, merge, doc publish, config changes) require human approval via dashboard or configured channel. |

## Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Local startup time (no Docker services) | < 3 seconds |
| NFR-2 | Embed mode memory footprint | < 512 MB resident |
| NFR-3 | Dashboard response time | < 200ms p95 for API calls |
| NFR-4 | Container image size | < 500 MB |
| NFR-5 | Zero mandatory external dependencies for core CLI | Node 18+ only |
| NFR-6 | Auth for multi-user | OAuth2 / API key, configurable |
| NFR-7 | Secrets handling | Never logged, never in observations, env-var or vault only |

## Acceptance criteria

- AC-1: `construct init` in a fresh repo produces a working .cx/ structure and agent configs that Claude Code, Codex, and Copilot can use in their next session.
- AC-2: `construct embed --config embed.yaml` runs a monitoring loop that produces at least one snapshot within the configured interval.
- AC-3: Construct's own PRD (this document) is managed by Construct's artifact system and appears in the dashboard.
- AC-4: `docker build` produces a runnable image; `docker run` starts dashboard + API with auth.
- AC-5: A provider with write capability can create and manage work items in the configured external system.
- AC-6: A provider with messaging capability can read history and post messages/snapshots to the configured channel.
- AC-7: The approval queue in the dashboard shows pending high-risk actions and allows approve/reject.

## Success metrics

| Metric | Target | Type |
|---|---|---|
| Construct repo managed by Construct | All PRDs/ADRs/RFCs authored through the system | Leading |
| Time from `construct init` to first cross-agent session | < 2 minutes | Leading |
| Embed snapshot accuracy | Risks identified match retrospective reality >70% | Lagging |
| Dashboard daily active usage (dogfood) | Used every working day during development | Leading |

## Constraints

- Zero npm dependencies for core CLI (providers and dashboard may add dependencies in isolated boundaries).
- Elastic-2.0 license.
- Cloud deployment must not create vendor lock-in in the core — the Dockerfile runs anywhere containers run. Infrastructure is defined in Terraform so it's reproducible, auditable, and portable across AWS accounts (or adaptable to other clouds).
- Provider implementations must not leak transport details into core. Core dispatches through the provider interface; the provider chooses MCP, REST, GraphQL, SDK, or whatever the external system supports.

## Dependencies

| Dependency | Owner | Risk |
|---|---|---|
| External system API/MCP access | User-provided credentials per provider | Medium — auth variance across systems |
| Docker for optional services | User's machine or cloud host | Low — optional, not required for core |
| LLM API access | User-provided keys (Anthropic, OpenAI, etc.) | Low — pluggable |

## Open questions

| # | Question | Owner | Deadline |
|---|---|---|---|
| OQ-1 | What is the minimum capability set a provider must expose? (read-only sufficient, or must all providers support write?) | Gerald | Phase 1 start |
| OQ-2 | What auth provider for multi-user dashboard? Self-contained JWT, or integrate with an IdP? | Gerald | Phase 3 start |
| OQ-3 | Should snapshots be versioned and diffable, or point-in-time only? | Gerald | Phase 2 start |
| OQ-4 | What is the approval SLA model — does a pending approval block the action indefinitely, or auto-expire? | Gerald | Phase 2 start |

## References

- Architecture: `docs/architecture.md`
- ADR on layered restructure: `docs/adr/0002-layered-architecture.md`
- Agent registry: `agents/registry.json`
- Orchestration policy: `lib/orchestration-policy.mjs`
