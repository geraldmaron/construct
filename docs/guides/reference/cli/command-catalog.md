---
title: CLI command catalog
description: Documented-vs-actual construct CLI surface with current, internal, and removed compat entries.
---

> Generated from `lib/cli-compat-catalog.mjs`. Re-run `node --test tests/cli-deprecated-surface.test.mjs` to refresh.

This page reconciles three sources:

1. The runtime dispatch table in `bin/construct`
2. The public catalog in `lib/cli-commands.mjs` (what `--help` and generated reference pages advertise)
3. Explicit sunset records for retired compatibility surfaces

## Sunset decisions

| Surface | Status | Replacement | Record |
| --- | --- | --- | --- |
| `construct matrix <subcommand>` | removed | `construct graph <subcommand>` | ADR-0053: Removed after ADR-0053 two-release-cycle deprecation window (alias shipped v1.5.0; removed construct-b0nny.28 / workspace-control-plane E9). |
| `construct install --scope=<project|user|both>` | removed | `construct install --footprint=<project|user|both>` | ADR-0071: Retired in Construct 2.0 cleanup; canonical install-write-target flag is --footprint per ADR-0071. |
| `construct models --reset` | removed | `construct models reset` | Retired top-level flag form; canonical subcommand is construct models reset. |
| `construct models --tier=<t> --set=<model>` | removed | `construct models set --tier=<reasoning|standard|fast> --model=<provider/model-id>` | Retired top-level flag form; canonical subcommand is construct models set --tier=<t> --model=<id>. |
| `construct models --poll` | removed | `construct models free` | Retired top-level flag form; canonical subcommand is construct models free. |

## Command inventory

| Command | Status | Category | Core help | Notes |
| --- | --- | --- | --- | --- |
| `acp` | current | Models & Integrations | no | Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients |
| `activation:status` | internal | Internal | no | Internal: agent activation telemetry |
| `approvals` | current | Core | yes | Manage pending MCP tool approvals |
| `artifact` | current | Work | no | Plan or locally execute manifest-backed artifact procedures with execution provenance |
| `ask` | current | Work | no | One-shot ask against the active knowledge index |
| `audit` | current | Diagnostics | no | Audit Construct internals and review the mutation trail |
| `auth:status` | current | Advanced | no | Check auth status |
| `backup` | current | Advanced | no | System backups |
| `beads` | current | Advanced | no | Task queue management |
| `beads:stats` | current | Advanced | no | Show beads counters and drift summary |
| `bootstrap` | current | Work | no | Import seed observation corpus into local memory store for cold-start acceleration |
| `capability` | current | Models & Integrations | no | Inspect typed operations the system can perform |
| `certify` | current | Diagnostics | no | Inspect and run scenario-based certification under .construct/certification/ |
| `ci` | current | Advanced | no | Local CI mirror: run CI jobs locally or view recent run status |
| `claude:allow` | current | Models & Integrations | no | Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it) |
| `cleanup` | current | Diagnostics | no | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `completions` | current | Advanced | no | Shell completion scripts |
| `config` | current | Advanced | no | Deployment mode configuration |
| `creds` | current | Integrations | no | Manage provider credentials (login, set, rotate, revoke, list, test) |
| `customer` | current | Work | no | Manage customer profiles for product intelligence |
| `db` | current | Models & Integrations | no | Inspect and migrate the optional Postgres backend |
| `decisions` | current | Advanced | no | Index load-bearing decisions and their enforcement bindings |
| `demo` | current | Work | no | Run guided tours or record VHS/asciinema tapes |
| `deployment` | current | Advanced | no | Deployment posture tools (capability parity contract) |
| `dev` | current | Core | yes | Start services for development |
| `diagram` | current | Work | no | Render code-driven diagrams via D2/Graphviz (optional system binaries; ADR-0001) |
| `diff` | current | Advanced | no | Show agent changes since HEAD |
| `directives` | current | Core | yes | View standing directives (construct.config.json directives[]) and their due status |
| `distill` | current | Work | no | Distill documents with query-focused chunking |
| `doc` | current | Diagnostics | no | Verify or inspect auditability stamps on Construct-generated markdown files |
| `docs` | current | Core | yes | Documentation commands |
| `docs:check` | current | Diagnostics | no | Check for missing how-to guides (alias for `docs check`) |
| `docs:reconcile` | current | Diagnostics | no | Reconcile docs against the registry |
| `docs:site` | current | Diagnostics | no | Regenerate generated reference pages under docs/guides/reference/ |
| `docs:update` | current | Diagnostics | no | Regenerate AUTO-managed doc regions (alias for `docs update`) |
| `docs:verify` | current | Diagnostics | no | Validate documentation quality (alias for `docs verify`) |
| `doctor` | current | Core | yes | Check installation health |
| `drop` | current | Work | no | Ingest file from Downloads/Desktop |
| `efficiency` | current | Observability | no | Show read efficiency, repeated files, and context-budget guidance |
| `embed` | current | Advanced | no | Embed mode management |
| `eval-datasets` | current | Observability | no | Sync scored traces from the telemetry backend into eval datasets for prompt regression testing |
| `evals` | current | Observability | no | Show evaluator catalog for prompt and agent experiments |
| `evaluator:rubrics` | internal | Internal | no | Internal: list registered evaluator rubrics |
| `execution` | current | Models & Integrations | no | Resolve the execution-capability contract for an embedded procedure (orchestrated vs prompt-only; descriptive, not enforced) |
| `export` | current | Work | no | Export markdown to PDF, DOCX, HTML, and other Pandoc formats via Pandoc + Typst (optional system binaries; ADR-0024) |
| `feedback:history` | current | Observability | no | Show recorded outcome ratings |
| `feedback:record` | current | Observability | no | Record an outcome rating for a recent worker invocation |
| `flow` | current | Models & Integrations | no | Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status |
| `gates:audit` | current | Advanced | no | Audit policy gates |
| `graph` | current | Work | no | Task graph management |
| `handoffs` | current | Work | no | List and inspect session handoff files in .construct/handoffs/ |
| `headhunt` | current | Work | no | Create domain expertise overlays |
| `hook` | internal | Internal | no | Hook dispatch — invoked by the harness, not by users |
| `hooks:health` | current | Advanced | no | Check hook health |
| `hosts` | current | Models & Integrations | no | Show host support for Construct orchestration |
| `impact` | current | Diagnostics | no | Change-impact analysis — map changed files to affected tests, capabilities, and procedures |
| `improvement` | current | Observability | no | Governed improvement loop — review, approve, and record apply/rollback for proposals |
| `infer` | current | Work | no | Infer schema from documents |
| `ingest` | current | Work | no | Convert documents to indexed markdown |
| `init` | current | Core | yes | Project setup (once per repo): scaffold .construct/, AGENTS.md, plan.md, adapters |
| `init:update` | internal | Internal | no | Internal: re-run init scaffolding for an existing project |
| `install` | current | Core | yes | Machine setup (footprint per ADR-0029/ADR-0071): --footprint=project\|user\|both, default project |
| `intake` | current | Core | yes | View and process the active profile's intake queue (queue label varies by profile) |
| `integrations` | current | Work | no | Check and manage external system connections |
| `knowledge` | current | Work | no | Query, index, or add to the project knowledge base |
| `lint:comments` | internal | Internal | no | Internal lint: source comments |
| `lint:contracts` | internal | n/a | no | Internal lint gate |
| `lint:research` | internal | Internal | no | Internal lint: research artifacts |
| `lint:templates` | internal | Internal | no | Internal lint: shipped templates |
| `lint:worker-profiles` | internal | Internal | no | Internal lint: worker profile definitions |
| `list` | current | Advanced | no | List worker profiles (shortcut for worker-profile list); shows active Workspace Preset |
| `llm-judge` | current | Observability | no | Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback |
| `matrix` | removed | n/a | no | construct graph replaced the matrix alias (ADR-0053; alias removed after sunset). |
| `mcp` | current | Models & Integrations | no | Manage MCP integrations |
| `memory` | current | Work | no | Inspect memory layer |
| `models` | current | Models & Integrations | no | Show or update model tier assignments |
| `monitor` | current | Advanced | no | One-command setup for continuous monitoring-as-a-role: sources.targets + embed.yaml roles + capability enable + daemon start |
| `ollama` | current | Integrations | no | Manage local Ollama models |
| `optimize` | current | Observability | no | Prompt optimization using telemetry trace quality scores |
| `oracle` | current | Core | yes | Oracle meta-controller — fleet health review and bounded-auto maintenance |
| `orchestrate` | current | Models & Integrations | no | Construct-owned local orchestration runtime and readiness preflight |
| `overrides` | internal | Internal | no | Internal: list project overrides over the catalog |
| `pack` | current | Work | no | Worker profile and workspace preset pack lifecycle |
| `persona` | removed | n/a | no | Worker Profile replaced the persona command in Construct 2.0. |
| `personas` | removed | n/a | no | Worker Profile replaced the personas command in Construct 2.0. |
| `plugin` | current | Models & Integrations | no | Manage external Construct plugin manifests |
| `policy` | current | Advanced | no | Inspect rules governing authority, approval, and external effects |
| `procedure` | current | Work | no | Inspect and invoke reusable deterministic procedures |
| `provider` | current | Advanced | no | Provider management |
| `providers` | current | Integrations | no | Provider status, circuit-breaker reset, and resource discovery |
| `prune` | internal | Internal | no | Internal: prune ephemeral storage entries |
| `publish` | current | Work | no | Publish typed artifacts: release gate + export PDF with figures + optional demos |
| `recommendations` | current | Core | yes | View and manage artifact recommendations |
| `reflect` | current | Work | no | Capture improvement feedback and update Construct core |
| `registry:generate-docs` | internal | Internal | no | Generate docs/guides/reference/capabilities.md from registry |
| `registry:status` | internal | Internal | no | Dev: capability registry inspector |
| `registry:validate` | internal | Internal | no | Validate the capability catalog or complete canonical registry |
| `resources` | internal | Internal | no | Internal: resource probe |
| `review` | current | Observability | no | Agent performance review from telemetry (run\|legacy), or a deterministic PR-diff review for CI (pr) |
| `role` | current | Advanced | no | Worker Profile invocation queue (event-driven dispatch) |
| `roles:list` | current | Advanced | no | List installed role contracts |
| `roles:set` | current | Advanced | no | Activate a role contract |
| `rules` | current | Diagnostics | no | Rule and hook reference telemetry rollup |
| `sandbox` | current | Core | yes | Isolated tmpdir-based environment for QA and worker dry-runs |
| `scheduler` | current | Advanced | no | Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup) |
| `scope` | removed | n/a | no | Workspace Preset replaced the scope command in Construct 2.0. |
| `search` | current | Work | no | Hybrid search across project state |
| `seed-traces` | internal | Internal | no | Dev fixture: seed traces for testing |
| `server` | current | Advanced | no | Shared workspace server with authentication, a Postgres-backed Workspace store, and a worker-claim queue for multi-user deployments. |
| `skills` | current | Advanced | no | Skill relevance detection |
| `sources` | current | Advanced | no | Manage typed integration source targets in construct.config.json |
| `specialist` | removed | n/a | no | Worker Profile replaced the specialist command in Construct 2.0. |
| `specialists` | removed | n/a | no | Worker Profile replaced the specialists command in Construct 2.0. |
| `status` | current | Core | yes | Show system health and credentials |
| `stop` | current | Core | yes | Stop all running services |
| `storage` | current | Work | no | Manage storage backend |
| `sync` | current | Core | yes | Sync agent adapters to AI tools |
| `synthesize` | current | Work | no | Cross-project synthesis: map each registered project, reduce to an origin-cited answer |
| `tags` | current | Work | no | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `team` | removed | n/a | no | Teams were retired in Construct 2.0; assign work via Worker Profiles. |
| `telemetry` | current | Observability | no | Query telemetry traces and latency data |
| `telemetry-backfill` | current | Observability | no | Backfill sparse traces with observations (trace backend) |
| `telemetry-setup` | current | Observability | no | Configure telemetry backend credentials and trace export (OTLP or Langfuse-compatible) |
| `templates` | current | Advanced | no | List doc templates and register custom document classes (project-tier overlay; builtin manifest untouched) |
| `tools` | current | Work | no | Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright) |
| `tracker` | current | Models & Integrations | no | Analyze registered projects and contribute governed issue proposals to an external tracker (Jira) |
| `tracker-projection` | current | Work | no | Beads projection, field authority, and reconciliation (construct-b0nny.27, target-model.md concept 16) — treats bd as a projection of the graph-informed Work model with explicit per-field authority, detect-and-report drift, and read-only raw-record-preserving import. Sits behind bd; issues no bd write. |
| `uninstall` | current | Advanced | no | Remove Construct state |
| `update` | current | Advanced | no | Reinstall this checkout |
| `upgrade` | current | Advanced | no | Upgrade to latest npm version |
| `validate` | current | Advanced | no | Validate registry structure |
| `version` | current | Advanced | no | Show version |
| `wireframe` | current | Work | no | Generate wireframes from description |
| `work-spec` | current | Work | no | Work spec schema + graph-informed decomposition check (construct-b0nny.23, target-model.md concepts 6/7/9) — cycle detection, declared-dependency graph resolution, and independence-claim verification over a Work spec's decomposition. |
| `worker-profile` | current | Work | no | Inspect assignable worker configurations |
| `workers` | current | Core | yes | List shared-deployment worker heartbeats (requires DATABASE_URL; optional for solo) |
| `workflow` | removed | n/a | no | Procedure replaced the workflow command in Construct 2.0. |
| `workplace-loop` | current | Work | no | Production sources/directives/workplace loop (construct-b0nny.25) — detects real signals from a connected source, checks them against Workspace strategy, and routes any proposed external effect through the governed-write chokepoint. |
| `workspace` | current | Work | no | Manage PM workspaces for multi-PM signal routing |
| `workspace-domain` | current | Work | no | Workspace domain model (construct-b0nny.22, target-model.md concept 1) — owner, membership, settings, lifecycle. Distinct from `construct workspace` above, which is the unrelated multi-PM signal-routing command. |
| `workspace-preset` | current | Core | yes | Inspect and apply workspace-wide defaults |

## Help-hidden compat surfaces

The following must not appear in default or per-command help text:

- `matrix-command`: ADR-0053 alias removed; use `construct graph`
- `install-scope-flag`: ADR-0071 install flag retired; use `--footprint`
- `models-reset-flag`: Use `construct models reset`
- `models-set-flag`: Use `construct models set --tier=… --model=…`
- `models-poll-flag`: Use `construct models free`
