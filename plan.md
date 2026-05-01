---
cx_doc_id: 019dc30f-7305-7e13-a0b1-f633ab2a2792
created_at: 2026-04-25T05:14:22.853Z
updated_at: 2026-04-29T00:00:00.000Z
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
- Beads prefix: `construct-` (issues named `construct-<hash>`)
- Active issues:
  - `construct-lvx` P0 — CI green after deploy/pages gating fixes
  - `construct-d4e` P1 — Embed daemon: consolidate and harden
  - `construct-sjs` P1 — TPM gap analysis and ticket creation (Phase 9)
  - `construct-oip` P2 — Docs lifecycle job: gap detection and authority routing
  - `construct-94c` P2 — Init-docs: unified TTY menus, intake routing, custom lane polish
  - `construct-an2` P3 — Shell completions and CLI surface polish

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
| 2.5 | Messaging provider — read channels/threads, post messages (Slack as first impl) | done | providers/slack/index.mjs, transport: Slack Web API |
| 2.6 | Code host provider — PRs, issues, reviews, repo metadata (GitHub as first impl) | done | providers/github/index.mjs, transport: gh CLI |
| 2.7 | Knowledge base provider — pages, search, create/update (Confluence/Notion as first impl) | done | providers/confluence/index.mjs, transport: REST API v2 |
| 2.8 | Provider test harness — contract tests any provider must pass | done | providers/lib/contract-tests.mjs, 35 tests passing |

**Acceptance**: `construct providers list` shows registered providers. `construct providers test <name>` validates the capability contract. At least 3 providers using different transports work end-to-end.

## Phase 3: Embed Mode & Snapshots

**Goal**: Construct runs as a daemon or scheduled process, monitoring sources through providers and producing organizational intelligence.

| # | Task | Status | Notes |
|---|---|---|---|
| 3.1 | Embed config schema — sources (provider refs), intervals, output targets, approval rules | done | lib/embed/config.mjs — schema + zero-dep YAML parser |
| 3.2 | Scheduler — cron-style or interval-based execution loop | done | lib/embed/scheduler.mjs |
| 3.3 | Snapshot engine — aggregate data from providers, produce health/risk/gap report | done | lib/embed/snapshot.mjs |
| 3.4 | Snapshot output targets — markdown file, messaging provider, dashboard, all configurable | done | lib/embed/output.mjs |
| 3.5 | Approval queue — high-risk actions (work item creation, merge, doc publish) go to queue | done | lib/embed/approval-queue.mjs |
| 3.6 | `construct embed start/stop/status` CLI commands | done | lib/cli-commands.mjs — embed + providers commands registered |
| 3.7 | Artifact generation — PRDs, RFCs, ADRs on demand or triggered by embed analysis | done | lib/embed/artifact.mjs — generateArtifact, listArtifacts, recommendArtifacts; `construct artifact` CLI command; 18 tests |
| 3.8 | Embedded operating profile — mission, strategy, focal resources, authority boundaries, artifact obligations, risk/gap model | done | `lib/embed/config.mjs` (targets[], roles), `lib/embed/snapshot.mjs` + `lib/embed/roadmap.mjs` (role lens injection); all 28 agents have `embedOrientation`; target resolver + role framing modules |

**Acceptance**: `construct embed --config ~/.construct/embed.yaml` produces a snapshot within configured interval. High-risk actions queue for approval. Snapshots appear in configured targets.

**Embed profile acceptance**: When embedded, Construct can state what it is watching, why those resources matter, which strategy and authority posture apply, what artifacts it is responsible for drafting or generating, and which gaps/risks block confident operation.

## Phase 4: Dashboard

**Goal**: Full web app. Auth, chat, approvals, config, mode-aware views.

| # | Task | Status | Notes |
|---|---|---|---|
| 4.1 | Tech choice ADR — framework, bundled in container | done | Vanilla JS + Node http — no build step, zero core deps, existing server extended |
| 4.2 | Auth — token-based, session cookie, Bearer header | done | lib/server/auth.mjs; CONSTRUCT_DASHBOARD_TOKEN in ~/.construct/config.env; `construct serve --token` generates token |
| 4.3 | Dashboard views — overview, embed status, snapshots, approval queue, config editor | done | Artifacts, Approvals, Snapshots, Chat, Config sections; /api/artifacts, /api/approvals, /api/snapshots, /api/config |
| 4.4 | Chat interface — interact with Construct through the dashboard | done | lib/server/chat.mjs; SSE streaming via claude --print CLI; /api/chat/stream, /api/chat, /api/chat/history |
| 4.5 | Config management — providers, embed settings, approval rules, all editable in UI | done | /api/config GET+POST reads/writes ~/.construct/config.env and ~/.construct/embed.yaml |
| 4.6 | Real-time updates — SSE for live status, new approvals, snapshot alerts, embed action toasts | done | SSE `notifyClients(event?)` supports typed JSON events; `lib/embed/notifications.mjs` event bus; daemon emits `embedEmbedNotification`; dashboard renders colour-coded toast (info/success/warning/error); 2 tests |
| 4.7 | Mode-aware layout — views adapt based on active mode (init, embed, point-at) | done | Mode badge in topbar: embed/live/init derived from config presence; CSS classes mode-embed/mode-live/mode-init |
| 4.8 | Role selector in Config panel | done | `#role-primary` + `#role-secondary` dropdowns populated from registry; saves to embed.yaml; `initRoleSelector()` in `app.js`; `/api/config` GET now returns `roles` |
| 4.9 | Infrastructure Terraform editor in React dashboard | done | File tree, code editor with dirty-state indicator, Validate/Outputs/Plan/Apply buttons; uses `/api/terraform/*` endpoints |
| 4.10 | Workflow screen with plan.md + workflow.json integration | done | Three-tab layout (Plan/Tasks/Phases); summary cards for task status counts; `/api/workflow` endpoint |
| 4.11 | Enhanced mode-aware navigation — show/hide navigation items based on embed mode to prevent Construct internal information from showing unless explicitly embedded | done | Modified dashboard/src/App.tsx to conditionally render navigation based on mode (init/embed/live); prevents exposing internal Construct details in dashboard unless explicitly embedded |

**Acceptance**: Dashboard serves on `construct up`. Users can log in, see status, chat with Construct, approve/reject actions, edit configs.

## Phase 5: Cloud Deployment & Multi-User

**Goal**: Single-container deployable with multi-user support.

| # | Task | Status | Notes |
|---|---|---|---|
| 5.1 | Dockerfile — single image with core, providers, dashboard, runtime | done | `Dockerfile`, `.dockerignore`; node:22-alpine, <500MB target, non-root user, health check |
| 5.2 | Terraform modules — VPC, ECS/Fargate, RDS, secrets, DNS, IAM | done | `deploy/terraform/` — 6 modules (vpc, iam, secrets, rds, ecs, dns) + environments/staging + environments/production |
| 5.3 | Webhook ingestion — receive events from providers for event-driven embed | done | `lib/server/webhook.mjs`; POST /api/webhooks/:provider; HMAC sig verification (GitHub, Slack, Jira, Confluence); 9 tests passing |
| 5.4 | Persistent state — mount or managed database for observations, sessions, artifacts | done (infra) | RDS PostgreSQL provisioned via Terraform; app-layer ORM integration is Phase 6 work |
| 5.5 | Multi-user isolation — user scoping for observations, sessions, configs | done (design) | Single shared token for Phase 5; per-user scoping deferred to Phase 6 alongside RAG pipeline |
| 5.6 | Hybrid approval model — autonomous for low-risk, approval-gated for high-risk | done | `approvalMode()` in `approval-queue.mjs`; `autoApprove` flag; low-risk prefix list; `auto-approved` status |
| 5.7 | Deployment guide — `terraform apply`, env vars, secrets, health checks | done | `deploy/RUNBOOK.md` — bootstrap, ECR push, token rotation, webhook config, rollback, monitoring, troubleshooting |
| 5.8 | CI/CD — build, test, push image, optional `terraform plan` on PR | done | `.github/workflows/deploy.yml` — test → build/push ECR → tf plan (PRs) → tf apply + ECS wait + smoke test + rollback |

**Acceptance**: `docker build && docker run` starts a working instance. Multi-user auth works. Webhook events trigger embed actions.

## Phase 6: Continuous Learning & Knowledge Base

**Goal**: RAG over historical decisions, trend detection, queryable knowledge base.

| # | Task | Status | Notes |
|---|---|---|---|
| 6.1 | RAG pipeline — index observations, decisions, artifacts for semantic retrieval | done | `lib/knowledge/rag.mjs`; hybrid BM25 + cosine (hashing-bow-v1); `buildCorpus`, `retrieve`, `assembleContext`, `ask`; 15 tests |
| 6.2 | Trend detection — surface recurring patterns, escalating risks, decision drift | done | `lib/knowledge/trends.mjs`; 4 detectors: recurringPatterns, escalatingRisks, decisionDrift, hotTopics; `buildTrendReport`; 11 tests |
| 6.3 | Knowledge base queries — "what do we know about X?", "what changed in the last week?" | done | `construct ask "<question>"` CLI command; `construct knowledge trends/index`; `/api/knowledge/ask` POST endpoint |
| 6.4 | Dashboard knowledge view — browse and search accumulated intelligence | done | Knowledge panel in dashboard: Ask tab (RAG query UI), Trends tab (hot topics, recurring patterns, escalating risks, decision drift), Index tab (corpus breakdown) |

**Acceptance**: `construct ask "what are the biggest risks?"` returns a sourced answer. Dashboard shows knowledge timeline. Trends are surfaced in snapshots.

## Phase 7: Continuous Self-Improvement Loop

**Goal**: Construct learns from every session and every piece of information it encounters — provider items, local documents, scores, and team conversations all feed the observation store. The daemon heals itself and surfaces a living roadmap.

| # | Task | Status | Notes |
|---|---|---|---|
| 7.1 | Snapshot items → observation store | done | `distillSnapshotItems()` in `daemon.mjs`; Jira issues, GitHub PRs, Slack messages all written as `insight` observations after each snapshot; dedup by item key+tag |
| 7.2 | `CX_DATA_DIR` env override for rootDir | done | `resolveRootDir(env)` in `daemon.mjs`; `LOCK_PATH`/`DAEMON_STATE_PATH` also resolved per-env; Docker volumes can now point `.cx/` to a named mount without code changes |
| 7.3 | Inbox watcher — ingest local filesystem documents into observations | done | `lib/embed/inbox.mjs` — `InboxWatcher` + `resolveInboxDirs`; watches `.cx/inbox/` always + `CX_INBOX_DIRS` colon-separated extra paths; agnostic (specs, ADRs, meeting notes, PDFs, Office, code, anything extractable); state-tracked to avoid re-processing; Job 8 in daemon, 2-min interval; 8 tests |
| 7.4 | Roadmap generator — cross-source prioritisation → `.cx/roadmap.md` | done | `lib/embed/roadmap.mjs` — `generateRoadmap`, `roadmapSlackSummary`; heuristic scoring: priority field + status weight + observation signal + risk overlap; excludes closed/done items; Job 9 in daemon, hourly; posts Slack summary if `SLACK_CHANNELS` set; 8 tests |
| 7.5 | Learned patterns injected into prompts | done | `lib/prompt-composer.mjs` — `buildLearnedPatternsBlock()`; injected before task-packet; capped 800 chars, min-confidence 0.7 |
| 7.6 | Score → observation feedback loop | done | `cx_score` in `lib/mcp/tools/telemetry.mjs`; score < 0.5 → `anti-pattern`; score ≥ 0.85 → `pattern` |
| 7.7 | Eval dataset sync | done | `lib/telemetry/eval-datasets.mjs`; `syncEvalDatasets()`; scored traces → Langfuse Datasets grouped by agent+workCategory; `construct eval-datasets` CLI |
| 7.8 | Self-healing daemon — 10 scheduled jobs | done | snapshot, provider-health, session-distill, self-repair, approval-expiry, eval-dataset-sync, prompt-regression-check, inbox-watcher, roadmap, docs-lifecycle |
| 7.9 | Authority guard — runtime enforcement of operating profile authority boundaries | done | `lib/embed/authority-guard.mjs`; `AuthorityGuard` maps action types to authority keys; autonomous/approval-queued/denied levels; threaded through `daemon.mjs` + `output.mjs`; Slack posts and roadmap Slack summaries now gated; 22 tests |
| 7.10 | `construct optimize` — pure JS optimize loop with Langfuse trace analysis + LLM patch generation | done | `scripts/optimize.mjs`; `--list` shows agents by quality score; fetches traces by `name`; bulk score join; applies patch to `skills/roles/<agent>.md`; auto-triggers `construct sync` after patch |
| 7.11 | Session-end optimize hook | done | `lib/server/chat.mjs` `maybeRunOptimize()`: fires after every session, spawns optimize detached for below-threshold agents every `CX_OPTIMIZE_INTERVAL` sessions (default 5) |
| 7.12 | Infrastructure tab — Terraform editor in dashboard | done | `authFetch` defined; `tfOriginal` + dirty indicator (`●`); Validate + Outputs buttons; `terraform validate`/`output` wired in server; all 4 run buttons disable together during execution |
| 7.13 | Multi-target embed — target resolver + workspace fallback | done | `lib/embed/target-resolver.mjs` — resolveTargets, routeArtifact, resolveArtifactPath; explicit → signal-discovered → workspace fallback; 8 tests |
| 7.14 | Role framing — embedOrientation lens for snapshots + roadmaps | done | `lib/embed/role-framing.mjs` — getOrientation, buildRoleLens, renderRoleLensSection; injected into snapshot/roadmap; 8 tests |
| 7.15 | Docs lifecycle job — gap detection, risk classification, authority routing | done | `lib/embed/docs-lifecycle.mjs` — detectDocGaps, runDocsLifecycle; Job 10 in daemon, 30-min interval; auto-fix low-risk, queue high-risk; 5 tests |
| 7.16 | Embed notification bus + Slack stub | done | `lib/embed/notifications.mjs` — emitEmbedNotification, onEmbedNotification, notifySlack; daemon emits on roadmap/docs-lifecycle; server subscribes → SSE toasts; Slack stub no-ops without `SLACK_EMBED_WEBHOOK_URL`; 2 tests |

**Acceptance**: `construct embed start` runs daemon. After first snapshot, open Jira/GitHub/Linear items appear in observation store. Dropping a file into `.cx/inbox/` (or any `CX_INBOX_DIRS` path) causes it to be ingested and observed within 2 min. `.cx/roadmap.md` updates hourly. Slack bot posts roadmap summary when `SLACK_BOT_TOKEN` + `SLACK_CHANNELS` set. Authority boundaries are enforced at runtime — approval-queued actions are held for approval, not silently executed.

## Phase 9: TPM Gap Analysis & Ticket Creation

**Goal**: Operator role monitors execution against strategy/PRDs/RFCs, identifies gaps, and creates Jira tickets to close them.

| # | Task | Status | Notes |
|---|---|---|---|
| 9.1 | Update operator role with TPM gap-analysis capability | done | Added gap analysis, execution monitoring counter-moves to skills/roles/operator.md |
| 9.2 | Add `execution-gap` job to daemon | done | Job 11: query strategy/PRDs/RFCs + Jira tickets, detect gaps, create tickets |
| 9.3 | Wire Atlassian provider for gap analysis | done | Use Jira provider search + createIssue in gap detection |
| 9.4 | Add gap analysis to snapshot engine | done | Include executionGaps in snapshot output |
| 9.5 | Test with platform reliability test data | done | Test data ready: PLATFORM-456 + PLATFORM-RELIABILITY-OVERVIEW.md |
| 9.6 | All 765 tests pass | done | Verified implementation doesn't break existing functionality |

**Acceptance**: `construct embed start` runs daemon. Job 11 detects missing Jira tickets for PLATFORM-456 requirements. Creates tickets automatically (or queues for approval). Gap analysis appears in snapshot output.

**Verification**: 
- `npm test` passes (765 tests)
- Operator role updated with execution gap counter-move
- Daemon has Job 11: execution-gap
- Snapshot includes executionGaps field
- Test data in `construct-test-data/` for platform reliability

## Phase 8: Production Memory & Vector Infrastructure

**Goal**: Replace hashing-based BM25 RAG with neural embeddings backed by pgvector. Observations gain semantic retrieval. Local ONNX default; OpenAI/Ollama override via env.

| # | Task | Status | Notes |
|---|---|---|---|
| 8.1 | Embedding engine — model-agnostic, local ONNX default (`all-MiniLM-L6-v2`, 384d) | done | `lib/storage/embeddings-engine.mjs`; adapters: `local-onnx`, `openai`, `ollama`, `legacy` |
| 8.2 | Local ONNX adapter | done | `lib/storage/embeddings-local.mjs`; `@xenova/transformers`; model cached at `~/.construct/cache/embeddings/` |
| 8.3 | OpenAI + Ollama adapters | done | `lib/storage/embeddings-openai.mjs`, `embeddings-ollama.mjs`; `CONSTRUCT_EMBEDDING_MODEL` env switch |
| 8.4 | pgvector migration — `vector(384)`, HNSW indexes, search functions | done | `db/migrations/002_pgvector.sql`; auto-run on `construct up` |
| 8.5 | Vector client — lazy-loaded pgvector; no-sql fallback for tests | done | `lib/storage/vector-client.mjs`; upsert, search, delete; null-sql path preserved |
| 8.6 | Observation store upgraded — neural search path alongside file fallback | done | `lib/observation-store.mjs`; SQL+vector path active when `DATABASE_URL` set |
| 8.7 | `construct up` starts pgvector Postgres | done | `lib/setup.mjs` `writeLocalPostgresCompose()` always runs with `--yes` + Docker; `pgvector/pgvector:pg16` image |
| 8.8 | `memory_search` MCP tool upgraded | done | `lib/knowledge/search.mjs`; `rootDir` positional arg; semantic path when vector client available |
| 8.9 | Test coverage — embedding engine, vector client, knowledge search | done | `tests/embedding-engine.test.mjs` (7), `tests/vector-client.test.mjs` (11), `tests/knowledge-search.test.mjs` (11); 29/29 pass |
| 8.10 | End-of-session hygiene rules in `AGENTS.md` + `buildAgentsGuide` template | done | Both `AGENTS.md` and `lib/project-init-shared.mjs` updated; CI green gate enforced |

**Acceptance**: `construct up` starts pgvector. `memory_search` returns semantically matched results. All 729 tests pass. CI green.

## How-to documentation

Written under `docs/how-to/`:

- `how-to-embed-start.md` — start, configure targets/roles, check, stop; 10-job table; docs lifecycle, toasts, Slack stub
- `how-to-inbox.md` — inbox watcher, `CX_INBOX_DIRS`, routing table, re-processing behavior
- `how-to-slack-setup.md` — full Slack app setup, scopes, signing secret, channel intent format, authority config
- `how-to-cx-data-dir.md` — override storage root, Docker volume example, path table
- `how-to-reflect.md` — `construct reflect` usage, targets, what gets written

## Documentation Maintenance

| # | Task | Status | Notes |
|---|---|---|---|
| D.1 | Reposition public docs to lead with agent usage inside OpenCode/Claude Code instead of CLI-first framing | done | `README.md`, `package.json` now lead with agent-surface usage, clarify orchestration vs agent framing, and move CLI setup behind the product story |

## Pending Config

| Var | Purpose | Status |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-...` from OAuth & Permissions → Install to Workspace | missing |
| `SLACK_SIGNING_SECRET` | From Slack app Basic Information page | missing |
| `SLACK_CHANNELS` | Comma-separated channel names for snapshots + roadmap posts | missing |
| `CX_DATA_DIR` | Override `.cx/` storage root (required for Docker persistence) | optional |
| `CX_INBOX_DIRS` | Colon-separated extra dirs for inbox watcher beyond `.cx/inbox/` | optional |

Slack bot scopes required: `channels:history`, `channels:read`, `chat:write`, `commands`.

## CI / GitHub Actions — activation gates

Workflows that require external infrastructure are gated on repo variables so they skip (not fail) when not configured:

| Workflow | Gate variable | How to activate |
|---|---|---|
| `deploy.yml` (Build/Push/Terraform) | `AWS_DEPLOY_ENABLED = true` | Set in repo Settings → Variables after configuring `AWS_DEPLOY_ROLE_ARN` secret + ECR/ECS |
| `pages.yml` (GitHub Pages) | `PAGES_ENABLED = true` | Enable Pages in repo Settings → Pages (source: GitHub Actions), then set variable |

## Recent Maintenance

| # | Task | Status | Notes |
|---|---|---|---|
| M.1 | Tighten `construct init-docs` defaults and prompt flow | done | No default `docs/architecture.md`; no default runbooks; numbered preset flow replaces open-text lane selection |
| M.2 | Move generated lane templates under `docs/<lane>/templates/` | done | Built-in and custom lanes now keep starter templates in a dedicated subdirectory |
| M.3 | Make custom-lane prompt reject negative answers like `nope` | done | `no`, `none`, `nope`, blank, and similar answers no longer create junk directories |
| M.4 | Expose shell completion as a first-class CLI command | done | `construct completions [bash|zsh|install]` added; completion generator now handles string and object subcommand metadata |
| M.5 | Expand `construct init-docs` with 3 new lanes + improved prompts | done | Added `postmortems`, `changelogs`, `onboarding` lanes; wired orphaned `incident-report.md` template; new `changelog-entry.md` + `onboarding.md` templates; preset descriptions + padded lane picker in interactive prompt; `suggestContextualLanes` extended; 731 tests pass |
| M.6 | Replace ad hoc CLI menus with shared TTY prompts and fix intake/docs routing | done | Added shared `tty-prompts` module; aligned `init-docs`, `mcp-manager`, and `headhunt` discrete choice menus; made `docs/intake/` a watched recursive drop zone; added `meetings` as its own docs lane; intake now promotes matching docs into existing lanes; updated Pages workflow to Node 22 + `upload-pages-artifact@v4` |

## Recent Verification

- `node --test tests/init-docs.test.mjs`
- `node --check lib/completions.mjs`
- `node --test tests/cli-surface.test.mjs`
- `node --test tests/init-docs.test.mjs tests/embed-inbox.test.mjs`
- `npm test`
- `node ./bin/construct docs:update --check`

Until those variables are set, the jobs are skipped — not failed — on every push.

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
