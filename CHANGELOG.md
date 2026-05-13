# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased

Accumulated since 1.0.0 (2026-05-08).

### Added

- Touch-free local install now starts pgvector on every `construct setup` (not just `--yes`), runs migrations on first connect, and writes `DATABASE_URL` to `~/.construct/config.env` whenever Docker is available. Interactive users no longer end up on the local-file vector fallback by accident.
- `construct doctor` probes Docker daemon reachability and `cm` (memory CLI) availability as warning-level checks. Previously a missing Docker or cm passed doctor cleanly and only surfaced as `construct up` errors, contradicting the doctor report.
- Magic-link bridge for local Langfuse — the dashboard "Open Langfuse" link now lands the user pre-authenticated as the seeded admin account, sidestepping the manual signup screen that broke the touch-free experience on first run. Bridge lives at `/api/services/langfuse/login` on the dashboard server.
- Opt-in Docker daemon auto-start for `construct up` and `construct setup` on macOS. Set `CONSTRUCT_AUTO_START_DOCKER=1` to enable; the default behaviour (skip when Docker is off) is unchanged so users who deliberately keep Docker quiet are not surprised.
- Five hard contract postconditions on agent handoffs (`agents/contracts.json`): cx-reviewer must produce findings or an explicit "no issues found" enumeration; cx-security's threat model must be updated within the contract window; cx-debugger must confirm root cause via reproduction, trace, or test; cx-docs-keeper must report a coherence diff; cx-designer must run an accessibility check. Verdicts that violate these post-conditions become `BLOCKED_CONTRACT` rather than passing silently. Validator extended to handle one-of grouping and enum constraints.
- `classifyEngineerFlavor` in the orchestration policy — cx-engineer now routes to `engineer.ai`, `engineer.data`, or `engineer.platform` overlays based on request signals, matching the pattern used by every other specialist. The three overlay files were already on disk and previously unreachable.
- Verbose routing trace under `CONSTRUCT_VERBOSE=1` — when set, `routeRequest` emits a one-line stderr trace naming each active role overlay and the keywords that matched it.
- Cookbook page `slash-command-index.md` groups the ~30 slash commands by user intent (understand / plan / design / build / review / ship / measure / work / remember). The previous IA only listed individual commands; users had no quick way to ask "what do I run for X?".
- Local-only-by-design section in `docs/concepts/gates-and-enforcement.md` documents which gates intentionally have no CI counterpart (claude/* branch push refusal, red-CI-before-push) and why, so future maintainers don't accidentally mirror them.
- Signal-driven proactive routing — `requestSignals(request, context)` produces a stable structured signals object (intent, work category, risk flags, ambiguity score, blast radius, success-metric presence, auth/payments flag), and `proactiveTriggers(signals)` surfaces specialists that should engage pre-dispatch with a one-line reason each. `routeRequest` unions the trigger output with the existing keyword-only paths and emits a multi-line `dispatchSummary` ("Engaging: cx-security (pre-dispatch threat model …), cx-engineer, …") so the routing decision is visible before work starts. Under `CONSTRUCT_VERBOSE=1` the trace also lands on stderr per specialist.
- Modern documentation site at `/v2/` with full-text search, structured navigation, a 5-minute getting-started path, task-oriented cookbook recipes (including walkthroughs for adding custom specialists, fixing policy violations, swapping LLM and retrieval components, and connecting Slack/GitHub/Jira+Confluence/Salesforce), and concept pages explaining the persona+specialists model, enforcement architecture, durable state, and local-first design. README rewritten as a landing page with links into the site.
- New `construct gates:audit` command surfaces gaps where a policy gate exists in CI but not locally, or where required-status-checks drift from the actual CI workflow. Runs in CI on every PR.
- Three-layer policy enforcement now activates automatically after `construct setup`: real-time comment lint at write time, commit-time policy gates via local hooks, and CI as the safety net. Each blocking gate has an explicit env-var bypass so legitimate exceptions leave an audit trail.
- Specialist persona framework — all 28 specialists now operate as their organizational counterparts (SRE owns reliability, QA owns test health, Security audits dependencies, etc.) with typed event handoffs, rate-limited invocations, and an approval queue for high-stakes decisions.
- L0 doctor daemon — autonomous health monitoring with auto-restart for managed services and structured escalation to specialist personas when deterministic rules can't resolve the problem.
- Cost tracking and budget enforcement — per-persona and global daily spend caps. Advisory by default; set `CONSTRUCT_BUDGET_ENFORCE=on` for hard-stop behavior. Doctor reports per-persona burn and pricing-source visibility.
- Dashboard Doctor page — live daemon state, cost burn with per-persona breakdown, approval queue, pending role invocations, recent audit trail. Auto-refreshes every 30 seconds.
- Dashboard provider configuration — editable settings for GitHub, Jira, Confluence, Slack, and Salesforce with inline credential management and three-state health classification (healthy / not-configured / unhealthy).
- Automatic routing for legal-compliance, business-strategist, operations, R&D-lead, and explorer specialists. These were defined but unreachable without an explicit user invocation — now keyword-matched requests (e.g., "review GDPR compliance", "set up the GTM strategy", "work out the critical path", "frame the hypothesis", "do a scoping pass") route to them automatically. Compliance, business-framing, and R&D-validation concerns surface pre-architecture on orchestrated work.
- Intent-aware routing layer. Keyword classifiers used to suffer false positives ("the AI is slow" routes to AI-systems architect; "coverage" substring-matches "rag" inside it). The new `routeRequestVerified` API and `orchestration_policy` MCP tool overlay an optional fast-tier LLM verifier on top of the keyword match, dropping flavors below a confidence threshold. Falls back to keyword-only when no model key is configured, errored, or `CONSTRUCT_INTENT_VERIFY=off`. A scoring script (`npm run eval:routing -- --verify`) measures precision/recall/F1 of keyword-only vs verified against a labeled corpus.

### Changed

- Default cloud Langfuse URL (`https://cloud.langfuse.com`) is no longer written to `~/.construct/config.env` on first run. Leaving it unset lets `construct up` pick the local-Docker path and write back the actual URL after Langfuse starts. The cloud default silently disabled local Langfuse, since the service-manager treats any non-localhost URL as a remote/configured backend.
- Pre-commit hook now runs `construct lint:comments` and `construct docs:verify` on the full diff (without `--staged`), matching CI behaviour. The earlier `--staged` scope let commits pass locally while CI failed on the full diff.
- CI workflow jobs now filter by changed paths via `dorny/paths-filter`. Doc-only PRs skip the test matrix, retrieval evals, dependency audit, and Postgres integration — they only run docs drift, comment lint, template lint, secret scan, and gates audit. Code PRs are unchanged.
- `scripts/test-embed-boundary.mjs` renamed to `scripts/embed-boundary-manual.mjs` so it no longer matches `node --test`'s auto-discovery glob. The script is a manual probe, not a unit test; it now picks a free port automatically and matches the actual dashboard startup banner.
- `lib/hooks/probe-before-read.js` renamed to `.mjs` to match the rest of the hook directory.
- Documentation site moved from MkDocs to Fumadocs, with a redesigned landing page, Geist typography, and a restrained electric-blue accent palette in both light and dark themes. The new site is the canonical docs surface; the MkDocs source (`site/`, `mkdocs.yml`) has been removed. Old per-topic markdown files (`docs/how-to/`, `docs/getting-started.md`, `docs/installation/`, `docs/reference/cli.md`, `docs/reference/hooks.md`) are deleted now that their content lives in the new IA (`docs/start/`, `docs/cookbook/`, `docs/reference/cli/`).
- Canonical architecture, prompt-surface, knowledge-layout, and embedding-boundary docs moved to `docs/concepts/` to match the docs-site information architecture. Tooling that operates on this repo's files (storage indexing, RAG, agent fences, doc-coupling checks, embed seed) updated. `construct init` still creates `docs/architecture.md` at the project root in downstream projects — the per-repo and per-downstream-project conventions are intentionally distinct.
- Beads issue-tracking data (`.beads/issues.jsonl`, `.beads/metadata.json`) is no longer committed — it's local working state. Shared infrastructure (hooks, config, README) remains tracked. Revisit when the project moves to a multi-person setup.
- Project-root cleanup: `sync-agents.mjs`, `test-embed-boundary.mjs`, and `test-instance-isolation.mjs` moved into `scripts/` alongside the existing tooling. Stale `snapshot.md` removed. Reduces the top-level entry count and matches the rest of the repo's directory conventions.
- Schema source files moved from `db/migrations/` to `db/schema/` to reflect what they are. Runner mechanism unchanged.
- Dashboard color contrast improved across all pages (WCAG AA on labels, AAA on body text).

### Fixed

- Documentation menu sub-pages no longer 404. Docs now live at the site root — `/cookbook/`, `/reference/`, `/start/`, `/concepts/` are the canonical URLs (matching standard docs-site convention), and the dedicated marketing landing remains at `/`. The CLI reference auto-generator and the `reference/hooks` slug were also producing or pointing at unreachable paths and have been corrected.
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
