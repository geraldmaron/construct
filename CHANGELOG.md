# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed — `db/migrations/` renamed to `db/schema/`

- Schema source files moved from `db/migrations/*.sql` to `db/schema/*.sql`. The directory name was technically inaccurate — `001_init.sql` is an initial schema baseline (no prior state to migrate from), not a true migration. Renaming to `db/schema/` reflects what the directory actually contains.
- `lib/storage/migrations.mjs::runMigrations` still walks the directory the same way: lexical order, applied filenames + hashes tracked in `construct_schema_migrations`, hash-locked drift detection, forward-only. The runner mechanism is unchanged — only the input directory path moved. The function name and bookkeeping table name are retained because they describe the runner's behavior accurately regardless of input.
- The `construct_schema_migrations` bookkeeping table records filenames only, not directory paths. Existing databases with prior applied state continue to work without re-application.
- Callsites updated: `lib/setup.mjs` (initial schema bootstrap path), `lib/storage/migrations.mjs` (default dir + docstring).

### Fixed — Help-output icon alignment

- `construct` (no args / unknown command) prints the command catalog with consistent column alignment. Emojis using the `U+FE0F` variation selector (e.g. `⌨️`, `🛠️`, `⬆️`, `🖥️`, `🗄️`, `🗒️`, `🏗️`, `⚖️`, `⚙️`, `✏️`, `ℹ️`) render as 1 visual column in macOS Terminal / iTerm2 despite the emoji-presentation intent; non-VS16 emojis render double-wide. The bare-emoji-plus-space layout produced a wobbly name column. `bin/construct` now pads VS16 emojis with an extra trailing space so the command-name column stays aligned regardless of which icon is used.

### Changed — Beads work-tracking data is local-only

- `.beads/issues.jsonl` and `.beads/metadata.json` are now `.gitignore`'d and untracked. Beads' SQL store (`.beads/`) remains the canonical local source. The git-shared bits — `config.yaml`, `hooks/*`, `.gitignore`, `README.md` — stay tracked so policy and tooling are still uniform across clones. When the project moves to a centrally-deployed / multi-person setup, revisit whether the work-tracking JSONL should be shared via git.

### Added — Three-layer enforcement hardening

Defense-in-depth so policy violations get caught during regular operations, not at code review.

- **Retrieval CI fix.** `.github/workflows/ci.yml` evals job pins `CONSTRUCT_EMBEDDING_MODEL=hashing` and uses `npm ci --ignore-scripts`. The eval fixture is calibrated against the deterministic hashing-bow-v1 embedding so the ONNX runtime download is unnecessary; skipping it eliminates the `ETIMEDOUT 150.171.109.150:443` CDN-flake failure mode.
- **`comment-lint` is now blocking** at PostToolUse. Banned patterns and missing required headers block the edit (exit 2) instead of printing a warning the agent ignores. Bypass: `CONSTRUCT_SKIP_COMMENT_LINT=1`.
- **Commit-time doc gate.** `.beads/hooks/pre-commit` chains a Construct policy section that calls `construct lint:comments --staged` and `construct docs:verify --staged`. Code edits under `lib/|bin/|src/|app/` without a matching `CHANGELOG.md` / `docs/**` / `.cx/context.*` update refuse to commit. Bypasses: `CONSTRUCT_SKIP_GATES=1`, `CONSTRUCT_SKIP_DOCS=1`.
- **`pre-push-gate.mjs` hardened.** Refuses to push `claude/*` branches without `CONSTRUCT_ALLOW_CLAUDE_PUSH=1`. Refuses to push when the last CI run on the current branch already failed. Adds `construct evals retrieval` and `construct docs:verify` to the local pre-push job set. Whole-gate bypass: `CONSTRUCT_SKIP_PREPUSH=1`.
- **`policy-engine.mjs` consolidation finished and wired up.** The hook existed but was never registered — its bootstrap + drive logic never fired. Now registered in `platforms/claude/settings.template.json` for PreToolUse (bootstrap), Stop (drive + new red-CI + new open-beads + drive-session advisory), and UserPromptSubmit (reserved). Fixed a pre-existing `existsSync` import bug that would have crashed PreToolUse if it ever ran.
- **Stop-time enforcement (new, in `policy-engine.mjs` Stop):**
  - **red-CI block** — `gh run list` for current branch; exits 2 if last run failed and the agent edited code this session. Bypass: `CONSTRUCT_STOP_OK_RED_CI=1`. Directly answers "agents walk away from red CI."
  - **open-beads block** — exits 2 if `bd list --status in_progress` returns any issue. Bypass: `CONSTRUCT_STOP_OK_OPEN_BD=1`. Replaces the deprecated `continuation-enforcer` TodoWrite hook with the beads-aware equivalent (per `CLAUDE.md:85`).
  - **drive-session advisory** — non-blocking surface of open `~/.cx/drive-session.json` sessions.
- **New `ci-status-check.mjs` UserPromptSubmit hook.** Queries `gh run list` once per prompt (60s cache) and injects the red-CI line into the agent observation so the agent can never plausibly say "I didn't know."
- **New `doc-coupling-check.mjs` PostToolUse hook.** Counts code edits per session; emits stderr advisories at thresholds 3, 5, 10 when no doc files have been touched. Soft predecessor to the commit gate.
- **Phantom hook drift cleanup.** Removed 9 registrations in `platforms/claude/settings.template.json` whose script files didn't exist (`bootstrap-guard`, `mcp-task-scope`, `repeated-read-guard`, `console-warn`, `continuation-enforcer`, `teammate-idle-guard`, `workflow-guard`, `drive-guard`, `task-completed-guard`). These silently no-op'd, creating an illusion of defense in depth that didn't exist — the single largest contributor to rules slipping through.
- **`construct doctor` now checks hook drift.** New blocking check walks `settings.template.json`, extracts every `lib/hooks/*.mjs` reference, and fails if any file is missing. Prevents the phantom-hook regression from recurring.
- **Cross-surface parity verifier finished** (closes the two open gaps in `construct-b5c`):
  - Added Codex surface to [lib/parity.mjs](lib/parity.mjs:99) — diffs `~/.codex/agents/*.toml` against the registry alongside the existing Claude + OpenCode checks. Doctor now reports `claude · opencode · codex` parity.
  - Parity check is no longer `optional: true` in `construct doctor` — drift now fails the doctor run instead of being silently observable.
- **PR template policy enforced locally** (closes the same failure mode that caught this PR's first CI run red):
  - New `construct lint:templates [--body-file=<path>] [--body=<string>]` command wraps `scripts/lint-commits-pr.mjs`, exposing the local-mode the script always supported but nothing called.
  - `pre-push-gate.mjs` now intercepts `gh pr create` and `gh pr edit` in addition to `git push`. Extracts `--body` / `--body-file` / `-F`, lints against the PR template policy, exits 2 on violation. Bypass: `CONSTRUCT_SKIP_PR_LINT=1`.
  - Fixed pre-existing bug in `scripts/lint-commits-pr.mjs:97` — used `require("node:fs")` in an ES module, silently failing `--body-file` mode for every caller. Now uses `import { readFileSync }` correctly.
- **Honest deprecation ledger.** `docs/hooks-deprecated.md` rewritten to accurately reflect what's in `policy-engine.mjs` vs. what's still stalled-mid-consolidation (task, workflow, mcp-scope, repeated-read, teammate-idle). The stalled items are now explicitly known gaps with follow-up pointers.

### Changed — Comment cleanup

- Deleted five live comment-policy violations: `lib/cache-strategy-google.js:24-25,32`, `lib/doc-stamp.mjs:83,87`, `lib/hooks/post-merge-docs-check.mjs:61`. `node bin/construct lint:comments` now reports zero violations.

### Added — Dashboard provider configuration surfaces

- **Models page is now editable.** Per-tier (reasoning/standard/fast) primary + fallback selection backed by `getProviderModelCatalog()`. Save persists to `agents/registry.json` via existing `POST /api/registry/models`. SSE notifies other tabs.
- **New `/providers` page** for integration providers (`lib/providers/`). Lists the five built-ins (github, atlassian-jira, atlassian-confluence, slack, salesforce) and any operator overrides from `~/.construct/providers.json`. Built-ins are read-only; overrides support add/delete via `POST /api/providers/registry`.
- **Credentials are status-only by design.** `GET /api/providers/credentials` returns env-var presence + masked preview (`sk-ant…abc1`). The dashboard never accepts API keys — users edit `~/.construct/config.env` out-of-band; `GET /api/providers/config-path` returns the absolute path for a copy-to-clipboard hint.
- **Override validation.** New `validateProviderEntry()` in [lib/providers/registry.mjs](lib/providers/registry.mjs) imports a candidate package and runs `assertProviderContract` without touching disk; the dashboard write path wraps it in a 5s timeout. Built-in IDs are refused. Failed loads write nothing (atomic `.tmp` → rename).
- **Health probes are explicit.** `GET /api/providers` defaults to no health probe (Salesforce/Jira can be slow); `?probe=1` runs them on demand from a per-card "Probe" button.

### Changed — Dashboard contrast sweep

- All dashboard pages: `text-gray-400` → `text-gray-600` (16 pages, ~50 sites). The previous color was 2.85:1 contrast on white — failed WCAG AA for all text sizes. The replacement is 7.27:1 — passes AAA. Affects loading states, empty states, IDs, file paths, and helper text.
- Workflow page status badges: `bg-gray-100 text-gray-500` → `bg-gray-100 text-gray-700` for the "Skipped" / "Todo" / phase-pending tags (was 4.21:1, borderline; now 9:1).

### Added — Dashboard credential CRUD + correct health classification

- **Inline credential editing** for all known providers. New shared component [dashboard/src/components/CredentialsCard.tsx](dashboard/src/components/CredentialsCard.tsx) renders a row per env var with Set / Update / Clear / Cancel actions. Used by both Models (LLM kind) and Providers (integration kind).
- **`POST /api/providers/credentials`** — body `{envVar, value}`, validates against the central `CREDENTIAL_MAP` allowlist, atomic write through `writeEnvValues()`, file forced to mode 0600, hot-reloads `process.env` so providers pick up the new value without a dashboard restart. Empty value unsets the key.
- **Audit log** at `~/.cx/credential-audit.jsonl`: `{ts, action: 'set'|'unset', envVar}` per change. Values never logged.
- **Auth gate**: localhost binds (`127.0.0.1` / `localhost` / `::1`) inherit OS file-permission security and don't require a dashboard token. Non-localhost binds require `CONSTRUCT_DASHBOARD_TOKEN` to be set; the existing CSRF + bearer/session check still applies.
- **Three-state provider health**: `GET /api/providers?probe=1` now returns `status: 'healthy' | 'not_configured' | 'unhealthy'`. A provider with no required env vars set reports `not_configured` (gray), not `unhealthy` (red). Missing Jira/Slack/Salesforce credentials no longer count as a degradation.
- **Plugin overrides now editable**: Providers page gained an "Edit" button on each non-built-in card; clicking pre-fills the existing add form with the override's `id` and `package`. Save reuses the existing `POST /api/providers/registry` (action: `save` replaces by id).
- **Grouped credentials response**: `GET /api/providers/credentials` reshaped from a flat list of `{provider, envVar, set, preview}` to grouped `{provider, label, kind, vars: [{envVar, set, preview}], configured: 'none'|'partial'|'full'}`. Multi-var providers (Jira, Confluence, Slack, Salesforce) now expose all required env vars individually with a per-provider configured indicator.

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

### Added — Construct on Construct (full org map)

- Cost-watcher ingestion fixed: now reads `input_tokens` / `output_tokens` / `cost_usd` / `agent` (the format stop-notify actually writes), strips the `cx-` prefix from agent names. Daily totals now reflect real spend.
- **All 28 personas onboarded** with at minimum `handoff.received` support. Strategic personas (cx-designer, cx-accessibility, cx-researcher) got tailored fences. The remaining invitational personas (cx-ai-engineer, cx-business-strategist, cx-data-analyst, cx-data-engineer, cx-devil-advocate, cx-evaluator, cx-explorer, cx-legal-compliance, cx-operations, cx-orchestrator, cx-rd-lead, cx-test-automation, cx-trace-reviewer, cx-ux-researcher) have minimal fences + handoff-only events. EVENT_OWNERSHIP entries added for `eval.regression` (cx-evaluator) and `trace.anomaly` (cx-trace-reviewer).

### Added — Construct on Construct (fence enforcement on Bash)

- [lib/hooks/guard-bash.mjs](lib/hooks/guard-bash.mjs) now performs role-fence checks on every Bash invocation while a persona is the most recently dispatched agent. `git commit` / `git push` route to commit/push fence actions (advisory — surfaced to stderr); other commands prefix-match against `fence.allowedCommands`. Outside-fence commands are hard-blocked (exit 2).
- [lib/roles/fence.mjs](lib/roles/fence.mjs) — `bash` action now uses **prefix matching** against `allowedCommands` so manifest entries like `"bd create"` match real invocations like `bd create -t bug ...`. Previously used exact-match glob which never fired in practice.

### Fixed — Construct on Construct (cost telemetry verification + safer defaults)

- Verified end-to-end: `stop-notify.mjs` writes `~/.cx/session-cost.jsonl` from the Claude Code transcript; the doctor's cost watcher ingests it; the ledger aggregates per-persona / per-day. Confirmed by simulating a stop event against this session's transcript (616 invocations, ~$361 spend ingested cleanly).
- Original defaults (`$1/persona/day`, `$10/total/day`) were unrealistically tight — a single Claude Opus turn with a large context can be ~$0.50-$1.00. With enforcement on, the gateway would have hard-stopped every persona dispatch immediately. Defaults bumped to `$10/persona/day` and `$50/total/day`.
- **Enforcement is now advisory-by-default.** `CONSTRUCT_BUDGET_ENFORCE` must be explicitly set to `on` to enable hard-stop. Without it, the cost watcher still records and reports spend (audit + dashboard /api/doctor visibility); the gateway always lets invocations through. Prevents surprise blockers when a user first turns the framework on.

### Fixed — Construct on Construct (cost bucketing + double-count)

- **Bucketing bug**: `recordSpend` previously used `dayKey(Date.now())` regardless of the entry's actual timestamp — any session-cost entry would land in today's bucket even if the turn happened on a previous UTC day. Now accepts a `ts` parameter (number or ISO string) and buckets correctly. Cost watcher passes the entry's `ts` from session-cost.jsonl.
- **Double-counting on doctor restart**: cost watcher previously tracked `lastSeenLineCount` in-memory only — a doctor restart caused it to re-ingest every prior entry, doubling the recorded daily spend. Now persists `lastIngestedTsMs` to `~/.cx/cost-watcher-state.json` and only ingests entries with timestamps after the cutoff.
- **Pricing-source visibility**: doctor report now surfaces the cost_source breakdown (e.g., `estimated:static=616`) and warns when ≥50% of entries used the static fallback (meaning Langfuse model sync isn't live and absolute spend numbers are approximate).

### Added — Construct on Construct (everything-done pass: MCP fence + approval surface + UI + prompts)

- **MCP fence enforcement** in [mcp-health-check.mjs](lib/hooks/mcp-health-check.mjs). When a persona declares `fence.allowedMcpTools`, MCP calls outside that list hard-block (exit 2). Dormant for personas that don't declare an MCP list — preserves backward compatibility.
- **Approval surface v1** — new [lib/roles/approval-surface.mjs](lib/roles/approval-surface.mjs). When a fence check returns `needs-approval`, the marker is appended to `~/.cx/approval-pending.jsonl` and an SSE toast is emitted through the embed notification bus. Used by [edit-guard.mjs](lib/hooks/edit-guard.mjs) and [guard-bash.mjs](lib/hooks/guard-bash.mjs).
- **`/api/doctor` extended** to return `approvals`, `pendingRoleInvocations`, and `onboardedPersonas` alongside the existing `daemon`/`audit`/`cost` fields. Costs limited to personas with non-zero spend.
- **Dashboard Doctor page** — new React component at [dashboard/src/pages/Doctor.tsx](dashboard/src/pages/Doctor.tsx) wired into [App.tsx](dashboard/src/App.tsx). Shows daemon state, cost burn (total + per-persona with progress bar), approval queue, pending role invocations, recent audit log. Auto-refreshes every 30s.
- **All 28 persona prompts now have the role-framework section.** The 14 invitational personas (ai-engineer, business-strategist, data-analyst, data-engineer, devil-advocate, evaluator, explorer, legal-compliance, operations, orchestrator, rd-lead, test-automation, trace-reviewer, ux-researcher) received a minimal section pointing to the manifest fence and the `next:cx-<role>` handoff syntax; the 3 strategic personas (designer, accessibility, researcher) got tailored sections.

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
