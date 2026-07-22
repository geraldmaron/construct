---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Execution Surfaces Truth Map (Wave 0)

Produced 2026-07-17 by a bounded read-only investigation agent; edited for format by the
program lead. All claims are agent-reported with file-path evidence as cited; items the lead
has independently confirmed are marked **confirmed**. Import counts are anchored
`from '<module>'` matches, not substring counts.

## 1. CLI

- Entry: `bin/construct` — single public binary (`package.json` `bin`), env via
  `lib/env-config.mjs`, ~80 top-level imports from `lib/`.
- Registry: `lib/cli-commands.mjs` — `CLI_COMMANDS` is descriptive metadata only
  (name/category/subcommands); actual dispatch is a large if/else ladder inside
  `bin/construct`. No `registerCommand` pattern.
- Scale: **111 top-level commands**, 282 `name:` entries including subcommands, across 8
  categories: Work (29), Advanced (29), Internal (26), Core (18), Models & Integrations (12),
  Observability (12), Diagnostics (11), Integrations (3).
- Verdict: implemented; the most load-bearing surface in the system.

## 2. Daemons / background processes

Coordinated by `lib/service-manager.mjs` (`startServices()` = `construct dev`):

| Daemon | Entry | Verdict |
|---|---|---|
| Oracle | `lib/oracle/daemon-entry.mjs` → `runOracleDaemon()` (`lib/oracle/index.mjs`) | Implemented; read-model synthesis, reconciliation, directive execution, remediation dispatch; liveness watched by `lib/doctor/watchers/oracle-liveness.mjs` |
| Embed | `lib/embed/daemon.mjs` | Implemented, heavily wired (8 importers); ~11 scheduled jobs: snapshot, provider-health, session-distill, self-repair, approval-expiry, write-intent-drain, eval-dataset-sync, prompt-regression-check, inbox-watcher, roadmap, directive-runner |
| Doctor | `startDoctor` (service-manager) → `lib/doctor/watchers/*` | Implemented (oracle-liveness, orchestration-runs, write-pipeline watchers) |

- **Duplicated schedulers:** `lib/scheduler/` (cron → launchd/systemd native triggers) vs
  `lib/embed/scheduler.mjs` (interval-based), plus the `scheduled-tasks` MCP as a third
  surface. `lib/scheduler/` is nearly orphaned (mutual import with `lib/hygiene/scan.mjs`
  only).
- Launcher: `.construct/launcher/run.mjs` — dependency-free 7-tier resolver (dev-path →
  self-repo → node_modules → npx → global → cached binary → docker); every hook invokes
  through it.

## 3. Hooks (`lib/hooks/*.mjs`)

~40 hook registrations in `.claude/settings.json` across 7 events, all via the launcher:

- **SessionStart:** session-start (context, git status, env notices).
- **PreToolUse:** policy-engine bootstrap-gate (blocks mutations until session grounded),
  orchestration-dispatch-guard, block-no-verify, pre-push-gate (tests+build, 180s),
  guard-bash (root delete / force-push / DDL), config-protection, mcp-health-check,
  edit-guard (hash-anchored).
- **PostToolUse:** JSON-validate, scan-secrets, adaptive-lint, comment-lint,
  brand-prose-lint, artifact-release-gate, doc-coupling-check, graph-impact-advisory,
  edit-accumulator, registry-sync, dep-audit, audit-reads, mcp-audit, agent-tracker,
  bash-output-logger, test-watch, post-merge-docs-check, post-merge-tracking, audit-trail,
  orchestration-dispatch-guard (post).
- **PostToolUseFailure:** model-fallback, mcp-health-check --mark-failure,
  context-window-recovery, edit-error-recovery.
- **PreCompact / Stop / UserPromptSubmit:** pre-compact; policy-engine Stop, stop-typecheck,
  readme-age-check, stop-notify, session-optimize, session-reflect,
  session-tracking-refresh; context-watch, ci-status-check.
- Several files in `lib/hooks/` are not registered in settings (e.g.
  `proactive-activation.mjs`, `rule-verifier.mjs`) — coverage audit warranted.

## 4. MCP server surface

- Entry: `lib/mcp/server.mjs` (thin dispatcher; stdio + http transports under
  `lib/mcp/transport/`; broker mode via `lib/mcp/broker.mjs`).
- Registration: concatenated defs in `lib/mcp/tool-definitions.mjs` from 4 partitions
  (project, skills, memory, workflow) plus self-registered `*.tool.mjs` modules auto-scanned
  by `lib/mcp/tool-registry.mjs`. Every def must carry a `TOOL_SAFETY` classification
  (`lib/mcp/tool-safety.mjs`) or load fails.
- **Core/long-tail split:** 18 flat core tools in ListTools (`CORE_TOOL_NAMES`); everything
  else is reached through the **`call` gateway meta-tool** whose `tool` param enumerates
  long-tail names. In-code rationale: a 77-tool flat surface (~15k tokens) overran 32k
  local-model windows.
- **Dynamic dispatch:** `dispatchToolByName(name, args)` (server.mjs, ~60-branch table) is
  shared by direct CallTool and `call`; unknown names go through
  `resolveUnknownToolName` → `tool-recovery.mjs`. Tools are reached by name string, not
  static import — static-import grep undercounts consumers.
- Guardrails: tool-budget, tool-rate-limit, destructive-gate/approval, tool-surface-parity
  asserted at load. Verdict: implemented, central (~15 modules reference the server).

## 5. Flow engine / workflow system — two systems, one dead

- **Live:** declarative workflow manifests — `lib/workflows/loader.mjs` →
  `lib/embedded-contract/workflow-defs.mjs` (`WORKFLOW_TYPES`, 15 types;
  `INTAKE_TO_WORKFLOW` maps classifier intake types). Manifest schema + validation
  (`validate.mjs`, `liveness.mjs`, `surface-parity.mjs`), templates in
  `templates/workflows/*.yml`, drift-tested by
  `tests/workflows/workflow-defs-drift.test.mjs`.
- **Dead:** `lib/flows/` state-machine engine (define/engine/checkpoint/joins/state). Sole
  consumer `lib/orchestration/delegation-flow.mjs` self-documents as having no live
  production caller (the MCP tool that drove it, `orchestration_delegation_next`, was
  removed); carried under `02-deadcode:module-test-only` in `scripts/audit/baseline.json`.
  **Confirmed** by the repo's own audit baseline.

## 6. Orchestration runtime

- Core: `lib/orchestration/runtime.mjs` + `worker.mjs` (planRun/executeRun/getRun); run
  persistence behind `run-store.mjs` with **duplicated backends** `run-store-sqlite.mjs` /
  `run-store-postgres.mjs` / `run-store-filesystem.mjs`.
- Dispatch surfaces: MCP `orchestration_run` (host-sampling loop via `host-sampling.mjs`),
  `orchestration_readiness`/`status`/`cancel`; ACP `session/prompt` (`lib/acp/server.mjs`);
  `worker_run`.
- Specialists/org: `specialists/org/` (contracts, frameworks, groups, policies, scopes,
  specialists, teams); classification and routing in `lib/orchestration/`
  (classification, routing-tables, flow-selection, recruiter, readiness, gates).
- **Competing routing layer:** `lib/roles/` (router, manifest, gateway, event-bus, catalog,
  approval-surface) resolves event→persona off the same
  `orchestration/routing-tables.mjs`. `roles/router.mjs` has 0 direct import-path
  consumers; roles are reached via gateway/hook-emit/event-bus from embed, oracle,
  intake, hooks, scopes. Much of roles routing is aspirational (silent null returns).
- Stale artifacts in tree: `lib/roles/manifest.mjs.bak`, `lib/policy/engine.mjs.bak`.

## 7. Provider / model loops

- `lib/model-router.mjs` — **16 inbound importers**, one of the hottest modules; supported
  by model-policy, model-tiers, model-free-selector, model-cheapest-provider, model-pricing;
  `model-registry.mjs` is a 501-byte near-stub.
- Provider adapters: `lib/providers/contract/adapters/{github,jira,confluence,slack,…}` each
  with `governed-write.mjs`; registry + adapter-factories.
- **Legacy tier:** `provider-capabilities-*.js`, `cache-strategy-*.js`,
  `token-estimator-*.js`, `token-engine.js`, `dispatch-batch.js` (May 2026 vintage `.js`) —
  likely superseded by `lib/models/` / `lib/providers/contract`.
- Credentials: credential-bootstrap, secret-resolver, secret-audit-wiring (audited at CLI
  and daemon entrypoints).

## 8. Memory / retrieval — two coexisting paths

- Observation store: `lib/observation-store.mjs` (**16 importers**) + `lib/entity-store.mjs`;
  MCP memory_search/memory_add_observations/memory_create_entities/memory_recent.
- Knowledge/RAG: `lib/knowledge/` (search = `knowledge_search`, rag, graph,
  research-store, synthesis, trends); vector store at `.construct/lancedb/`;
  `lib/mcp/memory-bridge.mjs` bridges to an external memory MCP.

## 9. Governed writes / approvals — five competing surfaces

- Write pipeline: `lib/writes/` (control-plane — 8 importers, write-intent, write-policy,
  envelope, sent-log); consumed by every provider governed-write, broker, provider-write
  tool, oracle directive-executor, embed write-intent-drain, CLI approvals.
- **Approval surfaces (5):** `lib/embed/approval-queue.mjs`, `lib/writes/write-intent.mjs`,
  `lib/mcp/destructive-approval.mjs` (+ destructive-gate), `lib/roles/approval-surface.mjs`,
  `lib/cli/approvals.mjs`. Authority guard: `lib/embed/authority-guard.mjs` (ADR-0089/0096).
- Verdict: implemented but fragmented; no single governed-write chokepoint.

## 10. Telemetry / evaluations / scoring

- `lib/mcp/tools/telemetry.mjs` (cxTrace, cxScore, sessionUsage, efficiencySnapshot) —
  **dual-registered** in the dispatch table as `cx_trace` (eager) and `cx_trace_telemetry`
  (lazy) — same module, two names.
- `lib/telemetry/` (client, backends, otel-tracer, llm-judge, eval-datasets,
  skill-outcomes, rule-calls, hook-calls, team-rollup, backfill, ingest, beads-fallback);
  evals also in `lib/evals/` + `config/evals/`; traces under `.construct/traces/`.

## Top duplicated / competing architectures

1. Two workflow/flow engines (live declarative `lib/workflows/` vs dead `lib/flows/`).
2. Five approval/authority surfaces (no single chokepoint).
3. Three schedulers (`lib/scheduler/`, `lib/embed/scheduler.mjs`, scheduled-tasks MCP).
4. Two daemons with overlapping poll/reconcile/self-repair/observe jobs (oracle vs embed).
5. Two routing layers (orchestration routing-tables vs roles router/gateway) — plus
   duplicated run-store backends and the dual cx_trace tool names.

## Top dead / disconnected components

1. `lib/flows/` + `lib/orchestration/delegation-flow.mjs` (repo's own baseline: dead).
2. `.bak` files: `lib/policy/engine.mjs.bak`, `lib/roles/manifest.mjs.bak`.
3. `lib/scheduler/` (orphaned; superseded by embed scheduler + scheduled-tasks MCP).
4. `roles/router.mjs` (0 direct importers; aspirational wiring).
5. Legacy provider `.js` tier (May 2026 vintage, pre-`lib/models/`); `cx_trace_telemetry`
   redundant alias.

## Highest-inbound-dependency modules

| Module | Anchored importers |
|---|---|
| `lib/model-router.mjs` | 16 |
| `lib/observation-store.mjs` | 16 |
| `lib/mcp/server.mjs` + dispatch | ~15 (plus all name-string dispatch) |
| `lib/writes/control-plane.mjs` | 8 |
| `lib/orchestration/runtime.mjs` | 5 (but the highest-value surfaces) |
| `lib/workflows/loader.mjs` | 5 (feeds the whole workflow catalog) |
