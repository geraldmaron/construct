# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased

Accumulated since 1.0.0 (2026-05-08).

### Added

- Modern documentation site at `/v2/` with full-text search, structured navigation, a 5-minute getting-started path, task-oriented cookbook recipes (including walkthroughs for adding custom specialists, fixing policy violations, swapping LLM and retrieval components, and connecting Slack/GitHub/Jira+Confluence/Salesforce), and concept pages explaining the persona+specialists model, enforcement architecture, durable state, and local-first design. README rewritten as a landing page with links into the site.
- New `construct gates:audit` command surfaces gaps where a policy gate exists in CI but not locally, or where required-status-checks drift from the actual CI workflow. Runs in CI on every PR.
- Three-layer policy enforcement now activates automatically after `construct setup`: real-time comment lint at write time, commit-time policy gates via local hooks, and CI as the safety net. Each blocking gate has an explicit env-var bypass so legitimate exceptions leave an audit trail.
- Specialist persona framework — all 28 specialists now operate as their organizational counterparts (SRE owns reliability, QA owns test health, Security audits dependencies, etc.) with typed event handoffs, rate-limited invocations, and an approval queue for high-stakes decisions.
- L0 doctor daemon — autonomous health monitoring with auto-restart for managed services and structured escalation to specialist personas when deterministic rules can't resolve the problem.
- Cost tracking and budget enforcement — per-persona and global daily spend caps. Advisory by default; set `CONSTRUCT_BUDGET_ENFORCE=on` for hard-stop behavior. Doctor reports per-persona burn and pricing-source visibility.
- Dashboard Doctor page — live daemon state, cost burn with per-persona breakdown, approval queue, pending role invocations, recent audit trail. Auto-refreshes every 30 seconds.
- Dashboard provider configuration — editable settings for GitHub, Jira, Confluence, Slack, and Salesforce with inline credential management and three-state health classification (healthy / not-configured / unhealthy).

### Changed

- Documentation site moved from MkDocs to Fumadocs. The new site is the canonical docs surface; the MkDocs source (`site/`, `mkdocs.yml`) has been removed. Old per-topic markdown files (`docs/how-to/`, `docs/getting-started.md`, `docs/installation/`, `docs/reference/cli.md`, `docs/reference/hooks.md`) are deleted now that their content lives in the new IA (`docs/start/`, `docs/cookbook/`, `docs/reference/cli/`).
- Beads issue-tracking data (`.beads/issues.jsonl`, `.beads/metadata.json`) is no longer committed — it's local working state. Shared infrastructure (hooks, config, README) remains tracked. Revisit when the project moves to a multi-person setup.
- Schema source files moved from `db/migrations/` to `db/schema/` to reflect what they are. Runner mechanism unchanged.
- Dashboard color contrast improved across all pages (WCAG AA on labels, AAA on body text).

### Fixed

- Retrieval evaluation CI job no longer flakes on transient CDN failures during ONNX runtime download.
- Help-output column alignment fixed for emoji rendering edge cases on macOS Terminal and iTerm2.
- Local pre-commit policy gates now fire automatically after `construct setup` — the hook files were previously tracked in `.beads/hooks/` but `core.hooksPath` was never wired, so every commit ran with zero local enforcement.
- Cost telemetry no longer double-counts on doctor daemon restart; per-day bucketing now respects entry timestamps rather than ingestion time.

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

These are encoded in `rules/common/release-gates.md`, summarized in `AGENTS.md`, and reflected in the CI matrix.
