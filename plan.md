---
cx_doc_id: 019dc30f-7305-7e13-a0b1-f633ab2a2792
created_at: 2026-04-25T05:14:22.853Z
updated_at: 2026-05-01T19:07:00.000Z
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
  - `construct-dj5` P3 — Live AWS deploy validation for ECS runtime contract
  - `construct-bo7` P3 — OAuth provider login and role-based auth implementation

## Current Gaps Not Yet Re-Ticketed

- `Phase 2.1` Web dashboard source/build sync is now wired and verified; remaining dashboard work is auth and any feature gaps that emerge after shipping source changes through the new build path.
- `Phase 2.2` Local auth groundwork is now in place; real GitHub/Google OAuth and RBAC implementation is re-ticketed as `construct-bo7`.
- `Phase 2.3` Single-container Docker deployment exists and the local runtime contract has been tightened; remaining live validation is re-ticketed as `construct-dj5`.
- `Phase 2.4` Terraform modules exist and local contract gaps have been fixed; remaining cloud-environment validation is re-ticketed as `construct-dj5`.
- `SLACK_BOT_TOKEN` remains missing, so Slack posting paths are configured but not active.

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
| 0.1 | CLI shell: `construct`, `construct doctor`, `construct sync` | done | Zero-npm-dependency; ~500 LOC; `lib/cli-commands.mjs` |
| 0.2 | Repository-aware project init: `construct init-docs` | done | Scans repo, recommends lanes, writes stub README/DESIGN.md, `lib/project-init-shared.mjs` |
| 0.3 | Agent sync: `construct sync-agents` | done | Reads `agents/registry.json`, writes agents markdown to `~/.claude/agents/`, updates `CLAUDE.md`; 9 tests |
| 0.4 | Provider abstraction | done | `lib/provider-interface.mjs`, `lib/provider-registry.mjs`; `init`, `read`, `write`, `search`, `webhook` capabilities; generic `notifyClients`; 4 test suites |
| 0.5 | MCP server scaffolding: `construct mcp-manager` | done | `lib/mcp-manager.mjs`; adds memory, github, atlassian MCPs |
| 0.6 | Embedded memory store via MCP server | done | `lib/mcp/memory.mjs`; `memory_search`, `memory_add_observations`, `memory_create_entities`; 7 tests |
| 0.7 | Dashboard auth — token generation, cookie validation | done | `lib/server/auth.mjs`; token stored in config.env; session cookie; `isAuthenticated` middleware; 5 tests |
| 0.8 | Chat interface: `/api/chat` + SSE toasts | done | `lib/server/chat.mjs`; conversation storage; history endpoint; `handleChat`; `notifyClients` |
| 0.9 | Approval queue — `api/approvals` endpoints | done | `lib/server/approvals.mjs`; queue items with `queueId`, `action`, `description`, `status`, `approvedBy`, `approvedAt`; 5 tests |
| 0.10 | Operating profile — authority configuration file | done | `lib/server/operating-profile.mjs`; `CX_OPERATING_PROFILE` path; `CX_OPERATING_PROFILE_ACTIVE` toggle; `approval` + `denied` keys per action type |
| 0.11 | TPM gap analysis & ticket creation (Phase 9) | done | Operator role updated; Job 11 added to daemon; Atlassian provider wired; snapshot includes executionGaps; 765 tests pass |
| 0.12 | Comment policy enforcement across git hooks, CI, and deployments | done | Pre-commit hook with LANGFUSE filtering; CI workflows (ci.yml, deploy.yml, release.yml); all violations fixed; 765 tests pass |

**Acceptance**: `construct init-docs` works. `construct sync-agents` writes agent files. `construct mcp-manager add memory` adds the memory MCP. `node --test` passes. Chat UI works with authentication. Approval queue holds external writes when profile demands approval. `construct embed start` detects missing Jira tickets and creates them (or queues for approval).

---

## Phase 1: Embed Daemon — Continuous Observation & Self-Repair

**Goal**: Daemon runs continuously, ingests external systems, detects gaps, creates tickets, heals itself, posts roadmap.

| # | Task | Status | Notes |
|---|---|---|---|
| 1.1 | Snapshot engine — collect open items from all configured providers | done | `lib/embed/snapshot-engine.mjs`; per-source `maxItems`; error capture; markdown render; `daemon.mjs` Job 1 (15 min) |
| 1.2 | Snapshot file-state preservation — `.cx/snapshots/{timestamp}.md` | done | `lib/embed/daemon.mjs` Job 1 writes snapshots; `lib/embed/snapshot-store.mjs` with indexing |
| 1.3 | Provider health check — `status()` call, error recovery | done | `lib/embed/daemon.mjs` Job 2 (30 min); `provider.health()`; `AUTH_ERROR`, `RATE_LIMIT_ERROR`, `NOT_FOUND` handling |
| 1.4 | Session distill — session files → observations | done | `lib/embed/daemon.mjs` Job 3 (5 min); reads `.cx/sessions/`, creates `session-summary` observations |
| 1.5 | Self-repair — fixes config drift, missing directories | done | `lib/embed/daemon.mjs` Job 4 (60 min); `.cx/` structure, agent files, missing hooks, etc. |
| 1.6 | Approval expiry — auto-approve stale items after timeout | done | `lib/embed/daemon.mjs` Job 5 (15 min); fallback:proceed policy; `CX_APPROVAL_EXPIRY_MINUTES` |
| 1.7 | Eval dataset sync — scored traces → Langfuse Datasets | done | `lib/embed/daemon.mjs` Job 6 (30 min); groups by agent+workCategory |
| 1.8 | Prompt regression check — stale agent prompts → alerts | done | `lib/embed/daemon.mjs` Job 7 (120 min); `agents/registry.json` hash vs `~/.claude/agents/` |
| 1.9 | Inbox watcher — ingest local filesystem documents into observations | done | `lib/embed/daemon.mjs` Job 8 (2 min); watches `.cx/inbox/` + `CX_INBOX_DIRS`; agnostic format; 8 tests |
| 1.10 | Roadmap generator — cross-source prioritisation → `.cx/roadmap.md` | done | `lib/embed/daemon.mjs` Job 9 (60 min); heuristic scoring; posts Slack summary if `SLACK_CHANNELS` set; 8 tests |
| 1.11 | Docs lifecycle job — gap detection, risk classification, authority routing | done | `lib/embed/daemon.mjs` Job 10 (30 min); auto-fix low-risk, queue high-risk; 5 tests |
| 1.12 | Execution gap analysis — TPM gap detection & ticket creation | done | `lib/embed/daemon.mjs` Job 11 (60 min); queries strategy/PRDs/RFCs + Jira tickets; creates tickets (or queues) |

**Acceptance**: `construct embed start` runs daemon. After first snapshot, open Jira/GitHub/Linear items appear in observation store. Dropping a file into `.cx/inbox/` (or any `CX_INBOX_DIRS` path) causes it to be ingested and observed within 2 min. `.cx/roadmap.md` updates hourly. Slack bot posts roadmap summary when `SLACK_BOT_TOKEN` + `SLACK_CHANNELS` set. Authority boundaries are enforced at runtime — approval-queued actions are held for approval, not silently executed.

---

## Phase 2: Continuous Deployment & Multi-User Dashboard

**Goal**: Dashboard is a full web app. Multi-user auth. Deployable via Docker. Terraform modules for cloud hosting.

| # | Task | Status | Notes |
|---|---|---|---|---|
| 2.1 | Web dashboard — React/Vite frontend | in progress | `dashboard/` directory exists; source-to-static sync now verified via `construct dashboard:sync`; auth/login remains token-based |
| 2.2 | Multi-user auth — OAuth via GitHub/Google, role-based permissions | planned | Local auth config groundwork is done; real provider-backed OAuth/RBAC tracked in `construct-bo7` |
| 2.3 | Dockerfile — single-container deployment | in progress | Dockerfile exists; local packaging/runtime contract fixed; live AWS validation tracked in `construct-dj5` |
| 2.4 | Terraform modules — AWS, GCP, Azure deployment | in progress | Terraform modules exist; local runtime wiring fixed; live cloud validation tracked in `construct-dj5` |
| 2.5 | GitHub Actions workflows — CI, deploy, release | done | `ci.yml`, `deploy.yml`, `release.yml`; gated by repo variables |
| 2.6 | GitHub Pages — public docs site | done | `pages.yml`; gated by `PAGES_ENABLED = true` |
| 2.7 | Comment policy enforcement | done | Pre-commit hook + CI workflows; all violations fixed |

**Acceptance**: `docker build && docker run` starts a working instance. Multi-user auth works. Webhook events trigger embed actions.

---

## Phase 6: Continuous Learning & Knowledge Base

**Goal**: RAG over historical decisions, trend detection, queryable knowledge base.

| # | Task | Status | Notes |
|---|---|---|---|
| 6.1 | RAG pipeline — index observations, decisions, artifacts for semantic retrieval | done | `lib/knowledge/rag.mjs`; hybrid BM25 + cosine (hashing-bow-v1); `buildCorpus`, `retrieve`, `assembleContext`, `ask`; 15 tests |
| 6.2 | Trend detection — surface recurring patterns, escalating risks, decision drift | done | `lib/knowledge/trends.mjs`; 4 detectors: recurringPatterns, escalatingRisks, decisionDrift, hotTopics; `buildTrendReport`; 11 tests |
| 6.3 | Knowledge base queries — "what do we know about X?", "what changed in the last week?" | done | `construct ask "<question>"` CLI command; `construct knowledge trends/index`; `/api/knowledge/ask` POST endpoint |
| 6.4 | Dashboard knowledge view — browse and search accumulated intelligence | done | Knowledge panel in dashboard: Ask tab (RAG query UI), Trends tab (hot topics, recurring patterns, escalating risks, decision drift), Index tab (corpus breakdown) |

**Acceptance**: `construct ask "what are the biggest risks?"` returns a sourced answer. Dashboard shows knowledge timeline. Trends are surfaced in snapshots.

---

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

---

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

---

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

---

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
| M.7 | Enforce comment policy across git hooks, CI, and deployments | done | Added comment policy enforcement to pre-commit hook (filters LANGFUSE warnings); added to CI workflows (ci.yml, deploy.yml, release.yml); fixed all violations in codebase; 765 tests pass with clean linter output |

## Recent Verification

- `node --test tests/init-docs.test.mjs`
- `node --check lib/completions.mjs`
- `node --test tests/cli-surface.test.mjs`
- `node --test tests/init-docs.test.mjs tests/embed-inbox.test.mjs`
- `npm test`
- `node ./bin/construct lint:comments` (comment policy enforcement)
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

- `npm test` passes (currently 765 tests)
- `construct sync-agents` writes agents to `~/.claude/agents/`
- `construct mcp-manager list` shows memory, github, atlassian
- `construct embed start` runs daemon with 11 jobs
- `construct ask "what are the biggest risks?"` returns a sourced answer
- Comment policy enforced: `construct lint:comments` passes, pre-commit hook blocks violations
- CI green on push: all workflows pass (or skip gracefully when gated)
- Dashboard starts with auth: `construct up` → `http://localhost:3000`

---

## ✅ Phase 9: Parallel Agent Beads Lock Manager (COMPLETED)

**Goal**: Eliminate lock errors and enable smooth parallel agent workflow with lock visibility, queueing, automatic plan/handoff updates, and stale lock cleanup.

**Implemented**:
1. **Lock manager** (`lib/beads-lock.mjs`) with stale‑detection and queue visibility
2. **Beads client wrapper** (`lib/beads-client.mjs`) for queued execution  
3. **CLI integration**: `construct beads <command>` for lock‑aware execution
4. **Automation**: Auto‑sync plan.md with bead status, handoff creation
5. **Merge‑slot bead** (`construct‑6uo`) for batch operation coordination
6. **Updated AGENTS.md** with parallel‑agent workflow

**Workflow**: Use `construct beads` instead of direct `bd`; check lock with `construct beads status`.

**Handoff**: `.cx/handoffs/2026-05-01-parallel-agent-beads-lock.md`
