# ADR-0002: Layered Architecture with Transport-Agnostic Provider Abstraction

- **Date**: 2026-04-28
- **Status**: proposed
- **Deciders**: Construct·Architect
- **Supersedes**: none

## Problem

Construct needs to integrate with an unbounded set of external systems — project trackers, messaging platforms, code hosts, knowledge bases, and anything else an organization uses. Each system has its own transport: some expose MCP servers, some have REST APIs, some have GraphQL, some have SDKs, some only have CLIs. Hardcoding integrations per system creates an ever-growing maintenance surface and couples core logic to transport details.

At the same time, Construct needs to grow from a CLI into a deployable product with a dashboard, cloud deployment, and embed mode without destabilizing the working core (orchestration, memory, sessions, MCP server).

## Context

- The core runtime (MCP server, orchestration policy, agent contracts, observation store) is stable and tested.
- The CLI surface is thin and command-driven, easy to extend.
- Docker service management already handles container lifecycle.
- No provider framework exists — integrations are ad-hoc or via MCP tools available at runtime.
- The dashboard is minimal — needs replacement with a full web app.
- No deployment surface exists.
- The zero-npm-core constraint applies to the CLI; providers and dashboard may bring their own dependencies.

## Decision

Structure the codebase into five layers with a transport-agnostic provider interface at the boundary between Construct and external systems.

```
core/         — CLI, MCP server, orchestration, memory, sessions
providers/    — abstract provider interface + per-system implementations
runtime/      — Docker management, embed daemon, scheduler
dashboard/    — full web app: auth, chat, approvals, config
deploy/       — Dockerfile, Terraform modules, cloud configs, multi-user auth
```

The **provider interface** defines a capability matrix (read, write, search, watch, webhook) that every external system adapter implements. The adapter chooses its own transport — MCP, REST, GraphQL, SDK, CLI subprocess, webhook listener, or any combination. Core never knows the transport. Core dispatches through the interface; the provider resolves it.

## Rationale

1. **Transport is the provider's problem, not core's.** An Atlassian provider might use the Atlassian MCP server. A GitHub provider might use `gh` CLI. A custom internal tool might use REST. Core doesn't care — it calls `provider.read()`, `provider.write()`, `provider.search()`.
2. **The core works.** MCP server, orchestration policy, agent contracts, and memory store are tested. Rewriting them gains nothing.
3. **The gaps are additive.** Providers, embed mode, dashboard, and deployment are new capabilities built on top of core, not replacements.
4. **Layering isolates risk.** A broken Slack provider doesn't crash the CLI. A dashboard regression doesn't affect embed mode.
5. **Zero-npm-core survives.** Core stays dependency-free. Each provider brings its own deps (MCP SDK, REST client, whatever).
6. **Unbounded extensibility.** New systems are added by implementing the provider interface. No core changes, no framework changes, no transport assumptions.

## Rejected alternatives

**Hardcoded integrations per system (Jira module, Slack module, GitHub module).** Rejected because it couples core to specific systems, creates N maintenance surfaces that grow linearly, and forces transport decisions into core code. Every new system requires core changes.

**MCP-only integration (require all external systems to expose MCP servers).** Rejected because not all systems have MCP servers, and requiring MCP as the sole transport excludes REST-only, GraphQL-only, and SDK-only systems. MCP is one valid transport among many.

**Plugin architecture with dynamic discovery and loading.** Rejected for now because the operational complexity (plugin registry, version resolution, sandboxing, security auditing of third-party plugins) is not justified at current scale. The provider interface is the contract; implementations can live in-tree or in separate packages without dynamic loading machinery.

**Full rewrite.** Rejected because the core is stable and the new capabilities layer on top of it.

## Consequences

- **Easier:** Adding a new external system = implement the provider interface, choose your transport. No core changes.
- **Easier:** Testing providers in isolation — mock the external system, verify the interface contract.
- **Harder:** Provider authors must map diverse system semantics onto a common capability matrix. Some mappings will be lossy (e.g., a system with no search → search capability returns `unsupported`).
- **Locked in:** The provider interface shape. Changing it requires updating all implementations. This should be designed carefully up front.
- **New constraint:** Providers are stateless adapters. Durable state (observations, sessions, cached data) lives in core stores, not in provider-local storage.

## Reversibility

Two-way door for the layering. The provider interface shape is a soft one-way door — it can evolve but breaking changes require a migration pass across all implementations. At current scale (< 10 providers) this is manageable.

## References

- PRD: `docs/prd/0001-construct-org-in-a-box.md`
- Architecture: `docs/architecture.md`
- ADR-0001: Zero npm core — `docs/adr/0001-zero-npm-core.md`
