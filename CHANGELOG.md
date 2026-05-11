# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added — Construct on Construct (foundation: role framework + v1 onboarding)

This is the first slice of the **Construct on Construct** initiative — Construct running its own organization, with deterministic L0 watchers, LLM personas at L1, and the user in the loop only for novel decisions or explicit approvals.

- New `lib/roles/` module: event-bus, router, gateway, fence, manifest loader, CLI handler. Personas now operate as their organizational counterparts — SRE owns reliability, QA owns test health, Security audits dependencies, Docs Keeper notices drift.
- `agents/role-manifests.json` declares onboarding state for all 28 personas; v1 wave (sre, qa, security, docs-keeper) ships fully wired.
- `EVENT_OWNERSHIP` map added to [lib/orchestration-policy.mjs](lib/orchestration-policy.mjs) next to the existing `DOC_OWNERSHIP`.
- Existing hooks now emit events when a domain signal fires: `pre-push-gate` → `push_gate.fail`, `stop-typecheck` → `test.fail`, `dep-audit` → `dep.cve`, `scan-secrets` → `secrets.detected`, `config-protection` → `config.protection.violation`. Service-manager emits `service.down` on probe failure.
- New hooks (unregistered by default — opt in via `platforms/claude/settings.template.json`): `test-watch.mjs`, `post-merge-docs-check.mjs`, `readme-age-check.mjs`.
- `construct role [list|latest|show|status|resolve|reset]` CLI lets users inspect pending invocations and the brief Construct dispatches.
- Session-start surfaces queued role invocations and drains the event backlog into bd issues with strict rate limits.
- Kill switches: `CONSTRUCT_ROLES=off` (global), `CONSTRUCT_ROLE_SRE=off` / `CONSTRUCT_ROLE_QA=off` / `CONSTRUCT_ROLE_SECURITY=off` / `CONSTRUCT_ROLE_DOCS_KEEPER=off` (per-persona).
- Persona prompts (cx-sre, cx-qa, cx-security, cx-docs-keeper) updated with a "When invoked via the role framework" section that names the fence and handoff syntax (`next:cx-<role>` bd label).

### Added — Construct on Construct (L0 doctor daemon)

- New `lib/doctor/` module: long-running daemon spawned by `construct up` next to dashboard/cm/opencode. Four watchers run on independent ticks: process-pressure (60s, extends `runtime-pressure`), service-health (60s, probes postgres/dashboard/cm + auto-restarts docker services), disk (5min, rotates `~/.cx/*.jsonl` and prunes `~/.construct/.runtime/`), cost (10min, ingests `session-cost.jsonl` into the daily ledger).
- New `lib/cost-ledger.mjs`: per-persona / per-day token-spend ledger with hard caps. Gateway checks budget before bd-create; persona invocations stop at the cap. Defaults: `$1/persona/day`, `$10/total/day`. Per-persona override via `CONSTRUCT_BUDGET_<PERSONA>=N`; global enforcement disable via `CONSTRUCT_BUDGET_ENFORCE=off`.
- All L0 actions audit-logged to `~/.cx/doctor-log.jsonl`. Daemon state at `~/.construct/doctor.json`.
- `construct doctor [check|status|watch|stop|logs|tick]` — plain `construct doctor` keeps running the system health check; subcommands manage the daemon.
- L0 → L1 bridge: when deterministic remediation fails (2 failed service restarts, repeated kill churn, disk below 500MB), the watcher escalates a `service.down` role event through the existing gateway, which routes to cx-sre.
- Kill switch: `CONSTRUCT_DOCTOR=off` (disables spawn during `construct up`).

## 1.0.0 — 2026-05-08

Initial public release.

Construct ships as a local-first agent orchestration layer for OpenCode, Claude Code, and other coding surfaces, with a single user-facing persona that routes work across specialist agents and keeps shared project state aligned.

### Highlights

- **Distribution** — three install modes: project-pinned npm devDependency, global npm install, and bootstrap shims (`.construct/run.mjs` + `bootstrap.sh` + `bootstrap.ps1`) for non-Node projects. `construct init --devcontainer` for VS Code teams.
- **Provider system** — capability-driven contract with five built-in providers (GitHub, Atlassian Jira, Atlassian Confluence, Slack, Salesforce), per-provider circuit breakers, and a stable plugin contract for custom providers.
- **Plugin retrieval engine** — six-layer plugin contract (Embedder, Chunker, Indexer, Fuser, Reranker, Compressor) with RRF + MMR defaults and an eval harness covering Recall@k, MRR, and NDCG.
- **Security middleware** — CSRF double-submit, CORS allowlist, token-bucket rate limiting, structured JSON-line logger. Multi-token dashboard auth with per-token roles.
- **Reliability** — runtime contract enforcement (`enforcePacket` with chain-hashed JSONL violation log), embed daemon supervision (launchd / systemd / Task Scheduler), full system backup with SHA-256 manifest.
- **Storage** — hybrid file-state + Postgres+pgvector + JSON vector index fallback, configurable embedding models (local ONNX, OpenAI, Ollama, hashing).
- **AWS deploy** — Terraform modules for ECS/Fargate ≥ 2 tasks behind ALB with sticky sessions, RDS with pgvector parameter group, Secrets Manager, CloudWatch alarms, multi-stage hardened Dockerfile.
- **CI/Release** — matrix CI (ubuntu/macos × Node 20/22 + real Postgres + gitleaks), release pipeline producing Node SEA binaries per OS/arch, Docker GHCR push + Trivy scan, npm publish with provenance.
- **Documentation** — full doc set: getting-started, installation guides, provider guides, operations runbooks, security, AWS deploy, CLI/config/hooks/MCP-tools reference. Deprecation infrastructure and semver policy.

### Hard release-gate contracts

Every commit and PR is enforced against the same five local gates and the canonical commit + PR templates:

- `npm test`
- `node bin/construct lint:comments`
- `node bin/construct docs:verify`
- `node bin/construct docs:update --check`
- `npm run lint:templates`

Shortcut: `npm run release:check`. Full policy in `rules/common/release-gates.md`.
