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

### Added — Construct on Construct (follow-up batch)

- Registered the three Phase B hooks in [platforms/claude/settings.template.json](platforms/claude/settings.template.json): `test-watch` and `post-merge-docs-check` as PostToolUse Bash; `readme-age-check` as Stop. Now wired and firing.
- Auto-restart for non-docker services in [lib/doctor/watchers/service-health.mjs](lib/doctor/watchers/service-health.mjs): dashboard restarts via idempotent `node bin/construct up` shell-out; cm restarts via `cm serve`. Postgres + Langfuse already used docker compose.
- Fence advisory check in [lib/hooks/edit-guard.mjs](lib/hooks/edit-guard.mjs): when the most recently dispatched persona is one we manage and the dispatch is fresh (<10 min), edits outside the declared fence are blocked (`outside-fence`) or warned (`needs-approval`). Reads `~/.cx/last-agent.json`.
- Handoff auto-enqueue in [lib/hooks/agent-tracker.mjs](lib/hooks/agent-tracker.mjs): when a completed Task's result text contains `next:cx-<role>` and the target persona is onboarded, an entry is appended to `~/.cx/role-pending.jsonl` so session-start surfaces it.
- New `/api/doctor` endpoint in [lib/server/index.mjs](lib/server/index.mjs): returns `{daemon, audit, cost: {total, byPersona}}` for the dashboard.
- Phase C — onboarded **cx-engineer**. Manifest entry with code-edit fence, allowed bd labels, handoff candidates (qa/reviewer/security/sre). Prompt updated with the "When invoked via the role framework" section. Engineer receives handoffs through agent-tracker's `next:cx-engineer` detection.

### Added — Construct on Construct (M1 + Phase C wave 2)

- `lib/doctor/report.mjs` + `construct doctor report --since=Nd` — tallies L0 actions, escalations, L1 events, pending invocations, cost. Used for M1 acceptance.
- `docs/runbooks/m1-self-host-sre.md` — the M1 acceptance protocol (pre-flight, daily check, criteria, failure modes, stop procedure).
- `docs/incidents/` pre-created with README — cx-sre's destination for incident reports during M1.
- Doctor `readState()` now clears stale state files when the recorded PID is gone — no manual cleanup needed after a crash.
- New `lib/doctor/watchers/bd-watch.mjs` (5th doctor watcher, 5-min cadence) — polls bd for issues labeled `next:cx-<role>` and enqueues handoffs for onboarded personas. Closes the gap where handoffs exist only as bd labels (not in Task result text).
- Phase C wave 2 — onboarded **cx-architect, cx-debugger, cx-release-manager, cx-product-manager, cx-reviewer, cx-platform-engineer**. Each gets manifest with fence + EVENT_OWNERSHIP entries + prompt section. 11 of 28 personas now wired.

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
