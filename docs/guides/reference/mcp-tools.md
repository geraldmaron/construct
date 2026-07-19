<!--
docs/guides/reference/mcp-tools.md: Every MCP tool exposed by the Construct MCP server.

Source of truth: the tool registry in lib/mcp/server.mjs. Every registered tool
must appear here as a `### tool_name` heading — enforced by
tests/mcp-tools-doc-parity.test.mjs, which fails if a tool ships without a doc
entry. Grouped by implementing module (project, document, storage, skills,
R&D-loop, telemetry, memory, knowledge/provider, workflow-orchestration,
profile/outcomes/learning, embedded-contract).
-->

# MCP Tools Reference

Construct exposes a Model Context Protocol (MCP) server consumed by Claude Code, OpenCode, and any other MCP-compatible host. Tools are registered in `lib/mcp/server.mjs` and implemented across `lib/mcp/tools/`. Most tools are hand-maintained in `HARDCODED_TOOL_DEFS`; a new tool may instead self-register by exporting `TOOL_DEFS`/`TOOL_HANDLERS` from a `<name>.tool.mjs` file under `lib/mcp/tools/` — `lib/mcp/tool-registry.mjs` scans and merges these into the same catalog with no edit to `server.mjs`, and requires an inline `safety` classification on every def.

## Tool surface (gateway)

To keep the serialized tool schema small enough for any context window — a flat 76-tool surface (~15k tokens) overran a 32k local-model window — `ListTools` exposes a **curated core** plus the `call` **gateway** and the `find_tool` **discovery** tool. The core front-loads the read/think tools (`orchestration_policy`, `orchestration_run`, `orchestration_readiness`, `get_skill`, `get_template`, `search_skills`, `suggest_skills`, `knowledge_search`, `memory_search`, `project_context`, `summarize_diff`, `find_tool`) **and the high-value action tools agents reach for directly** (`author_artifact`, `document_export`, `publish_run`, `artifact_workflow`, `triage_recommend`), since burying those behind the gateway made the common case the failing case. Every other tool stays reachable through `call`, and `find_tool` ranks the whole catalog by intent so the surface scales without a hand-maintained list (ADR-0048).

### `find_tool`
Find Construct tools by intent when you do not know the exact name. Pass a natural-language `query` (and optional `limit`) describing the task; returns the best-matching tools with their full input schemas, ranked by hybrid local-embedding semantic similarity merged with normalized BM25 — degrading to BM25-only when no semantic model is provisioned, so it works offline. Then invoke a result via `call` (or directly when it is a flat tool). E.g. `find_tool({ query: "export a markdown file to pdf" })` → `document_export`.

### `call`
Invoke any non-core Construct tool by name. Pass the tool name in `tool` (constrained to the catalog of available tools) and its arguments in `args` — e.g. `call({ tool: "workflow_status", args: { run_id } })`. The description lists namespaced tool groups and points to `find_tool` for intent-based discovery rather than enumerating every tool. Dispatches to the same handler as a direct call, so collapsing the surface costs no capability. The former name `construct_call` (and any `construct-mcp_`-prefixed tool name) is recovered tolerantly and the miss is recorded, so a stale or mis-typed name still resolves.

## Host wiring policy

The Construct MCP server (`construct-mcp`) is defined once in `registry` (`mcpServers`) and wired into every selected host by `scripts/sync-specialists.mjs` — Claude Code (project scope: `.mcp.json` → `mcpServers`; global scope: `~/.claude.json` → top-level `mcpServers` — settings.json carries hooks/permissions only, never MCP server definitions), OpenCode (`.opencode/opencode.json`), VS Code (`.vscode/mcp.json` → `servers`), Cursor (`.cursor/mcp.json` → `mcpServers`), and Codex (`.codex/config.toml` → `mcp_servers`). The `host-config-parity` functional test fails if any selected host drops it.

Credential handling diverges because hosts resolve env references at different times:

- **OpenCode — defer.** OpenCode keeps the `{env:VAR}` reference verbatim and resolves it at **runtime**. A server whose token env var is unset at sync time is still wired; it only fails to authenticate later if the variable is still missing when the host launches it.
- **Codex — omit.** Codex has no runtime env interpolation, so it needs the credential at **sync time**. `codexMcpEnvResolves` checks each server's `bearer_token_env_var`; an entry whose token is unresolved is **omitted** from `.codex/config.toml` rather than written with a dangling reference. Servers with no credential requirement — including `construct-mcp` itself, a local stdio server — always pass.

The result: OpenCode never blocks on a missing optional credential, and Codex never ships an entry that cannot authenticate.

## Project tools

### `agent_health`
Returns agent health summaries from the most recent performance review.

| Parameter | Type | Description |
|---|---|---|
| `agent_name` | string (optional) | Filter to a specific agent name |

### `summarize_diff`
Summarizes the git diff between the current state and a base ref.

| Parameter | Type | Description |
|---|---|---|
| `base_ref` | string (optional) | Git ref to diff against (default: `HEAD~1`) |
| `cwd` | string (optional) | Working directory |

### `scan_file`
Scans a file for secrets and code quality issues.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_path` | string | Yes | Absolute path to the file |

Returns: `{ secrets, quality_issues, clean }`. Quality checks: file too long (>800 lines), functions too long (>50 lines), TODO/FIXME markers.

### `project_context`
Returns project context: `.construct/context.md` content, recent commits, and working tree status.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory (default: `process.cwd()`) |

### `workflow_status`
Returns current workflow state, task alignment, and public health surface.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |

---

## Document tools

### `extract_document_text`
Extracts readable text from a local document. Supports PDF (macOS), text, and office formats.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_path` | string | Yes | Absolute or relative path to the document |
| `max_chars` | number | No | Max characters to return (default: 20,000; hard cap: 200,000) |

### `ingest_document`
Converts a local document into a normalized markdown file placed in an indexed project path.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_path` | string | Yes | Source document path |
| `out_path` | string | No | Explicit markdown output path |
| `out_dir` | string | No | Directory for output files |
| `target` | string | No | `knowledge/internal` \| `knowledge/external` \| `knowledge/decisions` \| `knowledge/how-tos` \| `knowledge/reference` |
| `cwd` | string | No | Project root |
| `sync` | boolean | No | Sync to SQL/vector storage after writing |

### `document_export`
Converts a markdown file into a distributable document — PDF, DOCX, legacy `.doc` (LibreOffice), deck HTML, PPTX, HTML, RTF, ODT, EPUB, LaTeX, plain text, or Markdown — via Pandoc and Typst (PDF engine). Optional pptxgenjs (PPTX) and LibreOffice (`.doc`) are discovered at runtime (ADR-0024); when tooling is absent, returns a structured `{ok:false, missing:[...], message:"Install pandoc..."}` instead of crashing. Use `detect_only=true` to check availability without running an export.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `format` | `pdf`, `docx`, `doc`, `deck`, `pptx`, `html`, `rtf`, `odt`, `epub`, `tex`, `txt`, `md`, `mdx` | Yes | Target format |
| `input_path` | string | No (yes unless `detect_only`) | Absolute path to the markdown source |
| `output_path` | string | No | Absolute output path; defaults to `<input>.<format>` next to the source |
| `detect_only` | boolean | No | Report binary availability without exporting (default `false`) |

### `publish_detect`
Detects availability of the full publish pipeline: Pandoc/Typst export, pandoc-ext/diagram figure rendering, VHS terminal demos, and Playwright dashboard demos. Mirrors `construct tools detect` and `construct publish --detect`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `format` | `pdf`, `docx`, `doc`, `deck`, `pptx`, `html`, `rtf`, `odt`, `epub`, `tex`, `txt`, `md`, `mdx` | No | Export format to probe (default `pdf`) |
| `figures` | boolean | No | Include figure binaries (default `true`) |
| `demo` | string | No | When set, require VHS/asciinema for terminal demo |
| `dashboard_demo` | string | No | When set, require Playwright workspace for dashboard demo |

### `publish_run`
Runs the publish pipeline: export markdown with optional figure filter and optional demo recordings. Mirrors `construct publish`. Use `dry_run=true` to probe tooling only without writing output.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input_path` | string | Yes | Absolute path to markdown research brief |
| `output_path` | string | No | Optional output path for export |
| `format` | `pdf`, `docx`, `doc`, `deck`, `pptx`, `html`, `rtf`, `odt`, `epub`, `tex`, `txt`, `md`, `mdx` | No | Target format (default `pdf`) |
| `demo` | string | No | Terminal tape name to record |
| `dashboard_demo` | string | No | Dashboard Playwright demo spec basename |
| `figures` | boolean | No | Render diagrams (default `true`) |
| `strict` | boolean | No | Fail when tooling missing (default `true`) |
| `source_only` | boolean | No | Write sources only (default `false`) |
| `dry_run` | boolean | No | Detect tooling only (default `false`) |

### `infer_document_schema`
Infers a structured field schema from a document (or reconciles across multiple documents).

| Parameter | Type | Description |
|---|---|---|
| `file_path` | string | Single document path |
| `file_paths` | string[] | Multiple documents for unified schema inference |
| `max_chars` | number | Max chars to send to the model (default: 40,000) |
| `save` | boolean | Write schema as `.schema.json` under `.construct/knowledge/reference/schemas/` |
| `cwd` | string | Project root |
| `sample_size` | number | Max docs to sample for unified inference (default: 10) |
| `threshold` | number | Min fraction of docs a field must appear in (default: 0.5) |

### `list_schema_artifacts`
Lists all inferred schema artifacts (`.schema.json` files) in the project.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory to search |

---

## Storage tools

### `storage_status`
Returns SQL, local vector index, and ingested-artifact status for the current project.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `project` | string (optional) | Explicit project key for SQL document counts |

### `storage_sync`
Syncs file-state documents into the local vector index and configured SQL storage.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `project` | string (optional) | Explicit project key |

### `storage_reset`
Resets SQL/vector storage state for a project. Requires explicit `confirm: true`.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `project` | string (optional) | Explicit project key |
| `reset_sql` | boolean | Set `false` to keep SQL state |
| `reset_vector` | boolean | Set `false` to keep vector index |
| `reset_ingested` | boolean | Set `true` to also delete ingested markdown artifacts |
| `confirm` | boolean | **Required**: must be `true` |

### `delete_ingested_artifacts`
Deletes ingested markdown artifacts. Requires explicit `confirm: true`.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `files` | string[] (optional) | Relative file paths under `.construct/knowledge/`. Omit to delete all. |
| `confirm` | boolean | **Required**: must be `true` |

---

## Skills tools

### `list_skills`
Lists all available categories and playbooks in the Construct knowledge base.

### `get_skill`
Reads a specific skill playbook from the knowledge base. Pass `specialistId` when reading on a specialist's behalf: if that specialist has a non-empty entitlement list and the skill is not on it, the response carries an entitlement warning (or, under `CONSTRUCT_STRICT_SKILLS=1`, an error instead of the content) — entitlement is advisory by default, since a bare MCP call carries no authenticated specialist identity to enforce against.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | Relative path to the skill (without `.md` extension, e.g. `security/security-arch`) |
| `specialistId` | string | No | The specialist this read is on behalf of (e.g. `cx-reviewer` or `reviewer`), for entitlement checking. Accepts either the specialistId or `agentId` name. |
| `agentId` | string | No | Alias for `specialistId`. |

### `search_skills`
Searches for a pattern within the Construct knowledge base skills.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | Yes | Regex pattern to search for |

### `get_template`
Reads a doc template by name. Resolves `.construct/templates/docs/{name}.md` first, then `templates/docs/{name}.md`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Template name without `.md` extension (e.g. `prd`, `adr`, `runbook`) |

### `list_templates`
Lists shipped and project-override doc templates.

### `worker_run`
Runs a bounded shell command via the worker plane and optionally records evidence on a named task graph node. Wraps `lib/worker/run.mjs:runJob`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `command` | string | Yes | Shell command to run (e.g. `npm test`) |
| `args` | string[] | | Argv to pass alongside the command (when not embedded in the command string) |
| `workspaceRef` | string | | Absolute path the job runs in. Must be inside `allowedPaths` (default: cwd) |
| `allowedPaths` | string[] | | Path allowlist for the workspace. Default: `[cwd]` |
| `timeoutSeconds` | number | | Hard timeout. Default: 300 |
| `envPolicy` | string | | `restricted` (default: PATH/HOME/USER/TZ/LANG plus `allowedEnvKeys`) or `inherit` |
| `allowedEnvKeys` | string[] | | Additional env keys allowed through under restricted policy |
| `graphId` | string | | Optional task graph id: when present with `nodeId`, evidence is recorded on that node |
| `nodeId` | string | | Optional task graph node id: when present with `graphId`, evidence is recorded |
| `evidenceType` | string | | `test-result` (default), `lint-result`, `build-result`, `manual-verification`, … |
| `evidenceSummary` | string | | Optional override for the evidence summary string |
| `traceId` | string | | Optional traceId to correlate with the rest of the agent's trace |

Returns the job result (`{status, exitCode, stdoutPath, stderrPath, durationMs, artifacts, traceId}`) plus an `evidence` field when a graph node was named. Stdout/stderr land under `.construct/runtime/worker/<jobId>.{stdout,stderr}.log`. Emits `worker.started` / `worker.completed` trace events from inside `runJob` and an `evidence.recorded` event when evidence is appended.

### `broker_check`
Queries the MCP broker's policy gate for a pending action without executing it. Use BEFORE attempting a high-risk action so the response (`allowed` / `approvalRequired` / `reason` / `source`) can be surfaced in the agent's voice rather than triggering a denial after the fact.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `role` | string | Yes | Persona name (e.g. `engineer`, `security`): must match a key in `specialists/role-manifests.json` for team / enterprise mode |
| `tool` | string | Yes | Tool the agent wants to invoke (e.g. `github`, `fs`) |
| `action` | string | Yes | Action on that tool (e.g. `create_pr`, `edit:lib/foo.mjs`) |
| `project` | string (optional) | | Project scope for the decision |
| `risk` | string (optional) | | `low` \| `medium` \| `high`: high actions need approval for non-autonomous roles |
| `traceId` | string (optional) | | TraceId to correlate this check with the rest of the agent's trace |

Returns `{ allowed, reason, approvalRequired, source, brokerActive }`. Solo mode returns `brokerActive: false` with `allowed: true` so agents skip the prompt overhead when the broker is inactive. Always emits a `tool.called` trace event for audit-trail parity.

### `orchestration_policy`
Classifies a request into intent, execution track, specialists, and approval boundaries.

For research-shaped requests, the response also carries `researchExecutionPolicy`: a surface-agnostic evidence ladder that says when to use local evidence, `knowledge_search`, Context7, direct official-doc web fetches, or other domain-primary sources. Hosts should follow that policy instead of assuming Context7 exists.

| Parameter | Type | Description |
|---|---|---|
| `request` | string | User request or objective text |
| `fileCount` | number | Approximate number of files involved |
| `moduleCount` | number | Approximate number of modules involved |
| `introducesContract` | boolean | Whether the change introduces a new contract |
| `explicitDrive` | boolean | Whether drive/full-send mode is active |
| `approval` | object | Approval-boundary flags (`scopeChange`, `productDecision`, `riskAcceptance`, etc.) |

## R&D-loop primitives

The intake, task-graph, and worker plane are surfaced through the `construct intake`, `construct graph`, and `construct storage` CLIs rather than MCP tools at this stage. The underlying modules are importable for agents that want to plan + execute programmatically:

| Module | Surface |
|---|---|
| `lib/intake/classify.mjs` | `classifyRdIntake({sourcePath, extractedText, related})` returns the triage block. Deterministic, no LLM. |
| `lib/intake/queue.mjs` | `createIntakeQueue(rootDir, env)` returns a queue implementing `{enqueue, listPending, count, read, markProcessed, markSkipped, reopen}`: Postgres-backed in team / enterprise mode, filesystem-backed in solo. |
| `lib/task-graph/generate.mjs` | `generateTaskGraphFromTriage({triage, project, request, intake})` derives the plan-of-work from a triage packet. |
| `lib/task-graph/store.mjs` | `FilesystemTaskGraphStore`: `.save / .read / .list / .updateNodeStatus` against `.construct/task-graphs/`. |
| `lib/context-router.mjs` | `buildContextPacket({request, triage, role, candidates, budget})`: per-role artifact bundle with explicit omitted reasons. |
| `lib/mcp/broker.mjs` | `Broker.invoke({role, tool, action, risk, execute})`: policy-gated MCP wrapper for team / enterprise. Throws typed `PolicyDenied`, `ApprovalRequired`, `RateLimited`. |
| `lib/worker/run.mjs` | `runJob({rootDir, job})`: bounded command execution with path-policy denial, timeout, restricted env, and trace event emission. |
| `lib/worker/evidence.mjs` | `evidenceFromJobResult`, `recordEvidence`, `blockedPacket`, `needsInputPacket`: typed verification packets gating node transitions. |
| `lib/worker/trace.mjs` | `emitTraceEvent({rootDir, eventType, traceId, …})`: writes `.construct/traces/<date>.jsonl` and exports remotely when configured. |

### `suggest_skills`
Ranks skills from the central catalog for a natural-language intent.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `intent` | string | Yes | Task description or keywords |
| `specialistId` | string | No | Optional cx-* id for entitlement hints |
| `limit` | number | No | Max suggestions |

---

## Telemetry tools

### `construct_trace`
Records a Construct execution trace through the shared telemetry adapter.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Worker Profile or workflow name |
| `id` | string | No | Trace UUID (auto-generated if omitted) |
| `session_id` | string | No | Session ID to group related spans |
| `metadata` | object | No | Extra metadata |
| `input` | string or object | No | Agent goal or user request |
| `output` | string or object | No | Agent deliverable or response |

Returns: `{ trace_id }`: pass to `construct_score` and `construct_trace_update`.

### `construct_trace_update`
Updates an existing telemetry trace with output and metadata.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `trace_id` | string | Yes | Trace ID from `cx_trace` |
| `output` | string or object | No | Final output |
| `metadata` | object | No | Additional metadata to merge |

### `construct_score`
Attaches a quality score to a trace through the shared telemetry adapter.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `trace_id` | string | Yes | Trace ID from `cx_trace` |
| `name` | string | Yes | Score name (use `"quality"`) |
| `value` | number | Yes | Score from 0.0 (poor) to 1.0 (excellent) |
| `comment` | string | No | Brief explanation |

### `session_usage`
Returns locally recorded token and cost usage for the current Construct session.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `home_dir` | string (optional) | Home directory override |

### `efficiency_snapshot`
Returns the read-efficiency snapshot for the current session (repeated reads, large reads, hot-spot files).

| Parameter | Type | Description |
|---|---|---|
| `home_dir` | string (optional) | Home directory override |

---

## Memory tools

### `memory_search`
Searches the observation store for patterns, decisions, and insights across sessions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Semantic search query |
| `role` | string | No | Filter by specialist role |
| `category` | string | No | Filter by category: `pattern`, `anti-pattern`, `dependency`, `decision`, `insight` |
| `project` | string | No | Filter by project name |
| `limit` | number | No | Max results (default: 10) |

### `memory_add_observations`
Records observations discovered during work. Indexed for semantic search and surfaced in future sessions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `observations` | array | Yes | Up to 10 observations. Each: `{ role, category, summary, content, tags, confidence }` |

### `memory_create_entities`
Tracks recurring entities (components, services, APIs).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `entities` | array | Yes | Up to 10 entities. Each: `{ name, type, summary, observation_ids }` |

### `memory_recent`
Returns the most recent observations for the current project, deduplicated by (role, summary).

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `project` | string (optional) | Project name filter |
| `limit` | number (optional) | Max observations (default: 10, max: 50) |

### `session_list`
Lists Construct sessions for the current project.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `status` | string (optional) | Filter: `active`, `completed`, `closed` |
| `limit` | number (optional) | Max results (default: 20) |

### `session_load`
Loads a full distilled session record by ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session ID to load |
| `cwd` | string | No | Project directory |

### `session_search`
Searches sessions by keyword in summary or project name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search keyword |
| `cwd` | string | No | Project directory |

### `session_save`
Updates the active session with distilled context.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session ID to update |
| `summary` | string | No | Brief summary (2-3 sentences) |
| `decisions` | string[] | No | Key decisions made |
| `files_changed` | array | No | `[{ path, reason }]` |
| `open_questions` | string[] | No | Unresolved questions or blockers |
| `task_snapshot` | array | No | `[{ id, subject, status }]` |
| `status` | string | No | `active`, `completed`, or `closed` |

### `rovo_search`
Cross-system semantic search via Atlassian Rovo. Searches Jira, Confluence, and other accessible sources.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search query |
| `top_k` | number | No | Max results (default: 10, max: 50) |
| `sources` | string | No | Comma-separated source filter (e.g. `"jira,confluence"`) |

---

## Knowledge & provider tools

### `knowledge_search`
Searches Construct's own documentation, knowledge base, and distilled embed observations. Call this for any question about how Construct works.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Natural-language question or keyword |
| `top_k` | number | No | Max excerpts to return (default: 5) |
| `repo_root` | string | No | Repo root override |
| `root_dir` | string | No | Data directory override for embed observations |

### `provider_fetch`
Looks up current data for a configured repo, project, or team. Resolves the right provider source automatically from configured `GITHUB_REPOS`, `JIRA_PROJECTS`, or `LINEAR_TEAMS`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | User's question or project/repo name |
| `root_dir` | string | No | Data root override |

### `provider_write`
Destructive. Governed external write to a contract-adapter provider (`jira`, `confluence`, `github`). `dry_run` defaults to `true` and only renders the would-write diff from the adapter's validation path (`renderDryRun`) — no network call, no side effect. Executing (`dry_run: false`) requires the out-of-band destructive-gate `approval_token`; the write then dispatches through the J2 envelope (`lib/writes/envelope.mjs`) — idempotency key, sent-log dedup, retry, audit — to the governed-write adapter. The adapter's `write()` is never called directly by this tool. When `specialist_id` names an embedded specialist, the proposed `<provider>.<item.type>` token is checked against that specialist's LMCP-E4 `embedBindings` grant before either mode proceeds.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | string | Yes | `jira` \| `confluence` \| `github` |
| `item` | object | Yes | Write payload; shape depends on provider (e.g. `{ type: 'issue', project, summary }` for jira) |
| `dry_run` | boolean | No | Default `true`. When `true`, returns the validated diff only. |
| `specialist_id` | string | No | Embedded-specialist caller id; enforces that specialist's embedBindings grant. |
| `idempotency_key` | string | No | Explicit idempotency key forwarded to the J2 envelope. |
| `approval_token` | string | Required to execute | Out-of-band destructive-gate token. |

## Workflow orchestration tools

### `workflow_init`
Initialize a new workflow for the current project. Creates plan.md state if not already present and returns the initial workflow envelope.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `title` | string | Workflow title shown in the plan header (default: "Untitled workflow"). |
| `spec_ref` | string | Optional reference to a spec/PRD/ADR id this workflow implements. |

### `workflow_add_task`
Add a task to the current workflow. Pass `request` for intent-based routing (the classifier picks track + specialist) or pass explicit task fields (`key`, `title`, etc.) for manual entry.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `request` | string | Natural-language task request; when present, intent-based routing is used and the explicit fields below act as overrides. |
| `key` | string | Stable task key (e.g. T-001). Generated when omitted. |
| `title` | string | Short task title. |
| `phase` | string | Phase bucket (plan, build, validate, ship, etc.). |
| `owner` | string | Specialist or persona that owns the task. |
| `files` | array | File paths this task touches. |
| `readFirst` | array | Files the owner should read before editing. |
| `doNotChange` | array | Files/regions the owner must not modify. |
| `acceptanceCriteria` | array | Acceptance criteria as a checklist. |
| `verification` | string | Command(s) or description of how to verify the task is done. |
| `dependsOn` | array | Task keys this task depends on. |
| `overlays` | array | Role flavors that augment the owner persona for this task. |
| `challengeRequired` | boolean | Force a cx-reviewer challenge (devil's-advocate overlay) before the task can complete. |
| `challengeStatus` | string | Initial challenge status when seeded. |
| `tokenBudget` | number | Per-task token budget for cost tracking. |
| `status` | string | Initial status override. |

### `workflow_update_task`
Update fields on an existing workflow task. Requires the task `key`. Only fields supplied are changed.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `key` | string | **required** — Task key to update. |
| `status` | string | New status (pending, in_progress, blocked_needs_user, blocked_by_dep, done, etc.). |
| `owner` | string | New owner persona. |
| `phase` | string | New phase bucket. |
| `note` | string | Append-only progress note. |
| `verification` | string | Updated verification description. |
| `overlays` | array | Replace the overlay list. |
| `challengeRequired` | boolean | Toggle whether a challenge is required. |
| `challengeStatus` | string | Update the challenge status (proposed, accepted, refused, etc.). |

### `workflow_needs_main_input`
Mark a workflow task as blocked pending user input. Sets status to blocked_needs_user and writes a packet describing the blocker for the orchestrator to surface.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `taskKey` | string | **required** — Task key to mark blocked. |
| `worker` | string | Specialist that needs input (default: current owner). |
| `blocker` | string | **required** — One-line description of what is blocking progress. |
| `question` | string | **required** — The specific question to put to the user. |

### `workflow_validate`
Validate the current workflow state against the schema and run consistency checks (no orphan tasks, no circular dependencies, every owner resolves to a known persona).

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |

### `workflow_contract_validate`
Validate a producer→consumer handoff against specialists/contracts.json. Required when a specialist hands off to another role: enforces input.mustContain, output schema, disk-artifact postconditions, and binary postconditions per producer (rubber-stamp prevention, post-hoc threat-model prevention, etc.). Self-enforcing: a producer with binary rules MUST pass `packet`, or the call itself is a contract violation.

| Parameter | Type | Description |
|---|---|---|
| `producer` | string | **required** — Producer agent or persona name (e.g. cx-reviewer, cx-security). |
| `consumer` | string | **required** — Consumer agent or persona name receiving the handoff. |
| `id` | string | Optional contract id; overrides producer/consumer lookup. |
| `artifact` | object | The handoff payload to validate against the contract schema and disk-artifact postconditions. |
| `packet` | object | The producer's in-memory output packet. REQUIRED when the producer has binary postconditions; omitting it is itself a contract violation. |
| `enforcement` | string | Enforcement mode (default: block). Use warn only when explicitly advisory. |

### `workflow_import_plan`
Bulk-add tasks from a markdown plan to the current workflow. Parses headings and bullet structure to extract task titles, owners, and acceptance criteria.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `markdown` | string | **required** — Plan markdown to parse. |
| `phase` | string | Phase bucket applied to all imported tasks. |
| `owner` | string | Default owner for tasks that do not specify one. |
| `readFirst` | array | Default readFirst files applied to all imported tasks. |
| `doNotChange` | array | Default doNotChange files applied to all imported tasks. |
| `acceptanceCriteria` | array | Default acceptance criteria applied to all imported tasks. |
| `title` | string | Workflow title to set if the workflow is newly created. |
| `spec_ref` | string | Spec reference to associate with the workflow. |

## Workspace Preset, outcomes, and learning tools

### `workspace_preset_show`
Return a Workspace Preset with its skills, procedures, artifact classes, intake taxonomy, hooks, and display settings.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `id` | string | Resolve a specific Workspace Preset instead of the configured preset. |

### `workspace_preset_list`
List the canonical Workspace Preset catalog with Skill and Procedure counts.

_No parameters._

### `workspace_preset_drafts`
List draft Workspace Presets under `.construct/workspace-presets/draft-*`.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |

### `workspace_preset_health`
Return outcome runs and success rates for a Workspace Preset over a time window.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `id` | string | Workspace Preset id (default: active preset). |
| `window_days` | number | Window in days (default 30). |

### `workspace_preset_create`
Scaffold a draft Workspace Preset under `.construct/workspace-presets/draft-<id>/`. Requires `confirm=true`.

| Parameter | Type | Description |
|---|---|---|
| `confirm` | boolean | **required** — Must be true. |
| `cwd` | string |  |
| `id` | string | **required** — Workspace Preset id (^[a-z][a-z0-9-]{1,30}$). |
| `display_name` | string |  |

### `workspace_preset_archive`
Archive a canonical Workspace Preset under `archive/workspace-presets/<id>/`. Destructive; requires `confirm=true` and a substantive reason.

| Parameter | Type | Description |
|---|---|---|
| `confirm` | boolean | **required** — Must be true. |
| `id` | string | **required** —  |
| `reason` | string | **required** — Substantive reason (>= 8 chars). |

### `outcomes_summary`
Read `.construct/outcomes/_summary.json` (per-role success rate, 30-day trend). Pass `aggregate=true` to rebuild the summary from JSONL outcome files first. Use to ground tiebreakers and improvement suggestions in real specialist performance.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |
| `aggregate` | boolean | Rebuild `_summary.json` before reading (default false). |

### `outcomes_record`
Append a specialist outcome line to `.construct/outcomes/<role>.jsonl` (writes durable state — requires `confirm=true`). Use when a specialist wants to self-report success/failure outside the automatic agent-tracker path.

| Parameter | Type | Description |
|---|---|---|
| `confirm` | boolean | **required** — Must be true. |
| `cwd` | string |  |
| `role` | string | **required** — Specialist id (e.g. cx-engineer, product-manager). |
| `success` | boolean | **required** —  |
| `intake_id` | string |  |
| `profile` | string | Override active profile id stamp. |
| `escalated` | boolean |  |
| `duration_ms` | number |  |
| `notes` | string | Trimmed to 500 chars. |
| `source` | string | Origin tag (default: "mcp"). |

### `knowledge_add`
Persist a research finding as `.construct/knowledge/external/research/<slug>.md` with research-specific frontmatter (topic, confidence, sources, expiresAt, profile). Writes durable state — requires `confirm=true`. `confidence=confirmed` requires at least one source.

| Parameter | Type | Description |
|---|---|---|
| `confirm` | boolean | **required** — Must be true. |
| `cwd` | string |  |
| `slug` | string | **required** — Lowercase hyphenated, max 60 chars. |
| `topic` | string | **required** —  |
| `body` | string | **required** — Findings / inferences / gaps / recommendation block. Capped at 50KB total file. |
| `confidence` | string | Default: inferred. |
| `sources` | array | Required when confidence=confirmed. |
| `ttl_days` | number | Default 90. |

### `knowledge_graph_ask`
GraphRAG-style global query over the entity graph in `.construct/observations/`. Detects communities via label propagation, ranks them by BM25 against the query, and returns each top community with its central members and extractive summary. Use for "tell me about how X relates across the project" questions that pure semantic retrieval handles poorly.

| Parameter | Type | Description |
|---|---|---|
| `query` | string | **required** — Natural-language question. |
| `cwd` | string | Project root (default: server cwd). |
| `top_k` | number | Max communities to return (default 5). |
| `min_size` | number | Skip communities smaller than this (default 2). |
| `tags` | array | Restrict entity extraction to observations carrying these tags. |
| `tag_match` | string | Tag match mode: any (default) or all. |

### `learning_status`
One-shot mirror of `npm run learning:status`: active profile, observation counts (last 24h + total), research finding count, per-role outcome rollup. Use to answer "is Construct learning?" without spawning a shell.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string | Project root (default: server cwd). |

### `sandbox_list`
List Construct sandboxes under `~/.construct/sandboxes/` (id, path, createdAt). Use to find an isolated environment for QA or dry-runs without polluting the active project.

_No parameters._

## Embedded contract tools

### `author_artifact`

Materializes a typed artifact you have drafted (PRD, ADR, RFC, meta-prd, runbook,
research-brief, evidence-brief) to its canonical path and runs the release gate.
The calling agent is the model: it drafts the markdown, this tool persists and
validates it, then returns the path and a structured PASS/FAIL verdict with errors
so the draft can be fixed and re-submitted. OpenCode and other supported hosts
reach this contract through the synced Construct MCP server.

| Parameter | Type | Description |
|---|---|---|
| `draft_markdown` | string | The complete artifact markdown — a single `#` title plus the type's required `##` sections. |
| `artifact_type` | string | Artifact type (defaults to `prd`; inferred from `subject` when omitted). |
| `subject` | string | Short subject/title hint used for the filename and type inference. |

### `artifact_workflow`

Plans a manifest-backed artifact workflow, or performs only locally observable
validation/export after `approval_mode: allow-durable-write`. The response
separates planned, executed, and skipped steps; it never presents a planned
specialist review or rewrite as completed execution.

Every artifact-workflow run reports a **completion ledger** — a chronological record of evidence backing each state advancement. An artifact's completionState is the highest rung of the 12-state ladder (planned → authored → structurally-valid → source-linted → exported → file-valid → renderable → screenshot-captured → visually-reviewed → accessibility-reviewed → approved → completed) for which it holds re-verifiable evidence. A state advances only with an explicit evidence object; missing tools are recorded as typed degradations (missing-dependency, unavailable-renderer, etc.) without advancing the ladder. See **[Artifact Completion States](artifact-completion-states.md)** for the full ladder and no-forgery invariant.

| Parameter | Type | Description |
|---|---|---|
| `input` | string | Natural-language artifact request. |
| `artifact_type` | string | Registered manifest document class. |
| `file_path` | string | Existing source document for local validation/export. |
| `format` | string | Requested distribution format. |
| `output_path` | string | Optional local export destination. |
| `branding` | string | `construct` (default) or explicit `plain` opt-out. |
| `approval_mode` | string | `allow-durable-write` is required for local validation/export. |

### `model_resolve`
Resolve which model an embedded Construct workflow should use given the host/IDE provider context. Precedence: host model → same-provider-family fallback → Construct tier default → structured config error. Never reads or returns credential values (requiresCredential is a boolean) and never claims unverified provider health. Read-only; performs no writes.

| Parameter | Type | Description |
|---|---|---|
| `workflow_type` | string | Workflow type hint (e.g. evidence-ingest, prd-draft, architecture-review). Selects a tier when requested_tier is absent. |
| `requested_tier` | string | Desired tier; overrides the workflow-type hint. |
| `host` | string | Host/IDE identifier (advisory). |
| `host_model` | string | Model the host is currently using (e.g. anthropic/claude-sonnet-4-6). |
| `host_provider` | string | Provider family the host uses, when no host_model is given. |
| `capabilities` | array | Optional required capabilities; unverifiable ones are returned as warnings. |
| `allow_cross_provider_fallback` | boolean | Permit falling back outside the host provider family (default false). |

### `triage_recommend`
Classify an artifact and return a role-aware plan (primary owner, role chain with rationale, suggested skills, evidence requirements, expected outputs, approval requirements, risks, next steps, canExecute) WITHOUT enqueuing or executing. Classification confidence is reported distinctly from any generation confidence. Read-only; performs no durable write.

| Parameter | Type | Description |
|---|---|---|
| `input` | string | Artifact text to classify (meeting notes, bug report, proposal, etc.). Provide this OR file_path. |
| `file_path` | string | Path to a file to extract and classify (PDF/Office via docling, audio/video via whisper, transcripts, plain text). Used when input is absent. |
| `source_path` | string | Optional filename/source hint to aid classification. |
| `artifact_type` | string | Optional artifact-type hint (advisory). |
| `domain` | string | Optional broad domain hint. |
| `desired_outcome` | string | Optional desired outcome (advisory). |
| `constraints` | array | Optional constraints (advisory). |
| `available_roles` | array | Restrict the plan to these role ids; dropped roles are reported as warnings. |

### `procedure_invoke`
Invoke a named Construct workflow (perspectives/skills) non-interactively and return a provenanced execution plan: selected roles, rationale, applied skills, resolved model, evidence requirements, output contract, risks, and a traceId. Construct returns the orchestration plan; the host runtime performs specialist reasoning. Durable writes occur ONLY when approval_mode is allow-durable-write; proposal-only and requires-human-approval perform no durable writes.

| Parameter | Type | Description |
|---|---|---|
| `workflow_type` | string | **required** — One of: evidence-ingest, proposal-review, prd-draft, architecture-review, risk-review, research-synthesis. |
| `input` | string | Artifact text the workflow operates on. Provide this OR file_path. |
| `file_path` | string | Path to a file to extract (docling/whisper/transcript) and operate on, used when input is absent. |
| `context` | object | Optional structured context; keys matching evidence requirements mark them satisfied. |
| `role_strategy` | string | auto = default chain; explicit = use requested_roles; constrained = default chain intersected with requested_roles. |
| `requested_roles` | array | Role ids for explicit/constrained strategies. |
| `approval_mode` | string | Gate for durable writes (default: the workflow type default). |
| `trace` | boolean | Emit a traceId for provenance correlation (default true). |
| `host` | string | Host/IDE identifier (advisory). |
| `host_model` | string | Model the host uses, for model resolution. |
| `host_provider` | string | Provider family the host uses, for model resolution. |
| `recruitment` | string | Signal-driven recruitment onto the manifest chain: `auto` (default) appends recruits, `off` disables. Recruits and their reasons return in `recruitment`; under `allow-durable-write` they are also recorded in the `.construct/observations` decision trace. |

### `capability_describe`
Describe what this Construct install can do: versions, contract interfaces (CLI/MCP/SDK), roles, skills, workflows, schemas, models/providers, policies, telemetry posture, and plugins. Read-only and secret-free — provider entries carry env-key names and a configured boolean only, never credential values. Reads live registries so the published contract cannot drift from reality.

| Parameter | Type | Description |
|---|---|---|
| `root_dir` | string | Optional Construct install root (default: server toolkit dir). |

### `construct_execution_resolve`
Resolve the execution-capability contract for an embedded workflow before/at workflow start: `executionMode` (construct-orchestrated | construct-prompt-only | host-direct | same-family-fallback), `constructCapabilitiesActive` (subset of personas/skills/workflow-routing/prompt-envelope), `degraded` + machine-readable `degradationReason`, `requestedStrategy` vs `effectiveStrategy`, and the resolved provider/model. Descriptive, not enforced (ADR-0019): reports what Construct planned and can resolve a model for, never an observation that the host ran personas (see the `semantics` field). Read-only and secret-free.

| Parameter | Type | Description |
|---|---|---|
| `workflow_type` | string | Workflow whose orchestration plan is weighed (e.g. evidence-ingest, architecture-review). Absent ⇒ generic orchestration availability. |
| `requested_strategy` | string | `orchestrated` \| `prompt-only` \| `auto` (default auto). |
| `use_construct` | boolean | `false` ⇒ host-direct (host runs without Construct capabilities). Default true. |
| `host` | string | Host/IDE identifier (advisory). |
| `host_model` | string | Model the host is currently using, for model resolution. |
| `host_provider` | string | Provider family the host uses, when no host_model is given. |
| `requested_tier` | string | `reasoning` \| `standard` \| `fast`; overrides the workflow-type hint. |
| `capabilities` | string[] | Optional required capabilities; unverifiable ones are returned as warnings. |
| `allow_cross_provider_fallback` | boolean | Permit model fallback outside the host provider family (default false). |

### `web_search`
Search the public web and return CITED results — the only search surface that reaches the open web, kept distinct from `knowledge_search` / `provider_fetch` / repo search so it is never conflated or faked. Requires a governed provider (`WEB_SEARCH_URL`); without one it returns a typed degradation (`capability-unavailable`) and zero results, never source/repo results dressed as web. Every result carries a verifiable URL, a claim-relative class, and an Admiralty grade with derived confidence (ADR-0017; `high` is reserved for A1/A2/B1).

| Parameter | Type | Description |
|---|---|---|
| `query` | string | **required** — The search query string. |
| `claim` | string | **required** — The claim the results support; drives claim-relative source classification (ADR-0017). |
| `recency` | string | Optional freshness window hint (e.g. `30d`). |

### `orchestration_run`
Execute a real multi-specialist orchestration run and return per-specialist output — the executing counterpart to `procedure_invoke` (which only plans). For MCP hosts with no subagent primitive (VS Code/Copilot, Cursor), this is how a specialist chain actually runs: the engine owns orchestration, the tool is the thin client (ADR-0022). Solo runs execute in-process — no daemon, no port, no token; a remote/team orchestration service is opt-in via `CONSTRUCT_ORCHESTRATION_URL`.

Three worker backends. `host` (the default for MCP-originated runs when neither `worker_backend` nor `construct.config.json`'s `orchestration.workerBackend` is set) materializes each specialist's prompt without spending any provider API credits — the calling host executes it in its own model session (the subscription it is already running under) and submits the result via `orchestration_task_result`; when the connected client declares the MCP `sampling` capability, construct-mcp instead drives that same loop itself (ADR-0063) and the run can complete in this same call. `provider` executes specialists against a configured provider key (real API spend). `inline` only prepares tasks — no execution at all (this stays the CLI's own default; the CLI has no attached host session to execute a `host`-backend run against).

A `host`-backend run whose materialization completes returns `status: 'awaiting-host'` — a real, non-terminal standing state (never rendered as `completed` or `degraded`) — plus every task's materialized `system`/`user` prompt and a `hostInstructions` string describing exactly what to do next.

The response's `specialists` field is the real, dispatched role list — authoritative. `routePath.specialistSequence` can be non-empty even when `specialists`/`tasks` are empty: a short request with no scope signal (no `file_count`/`module_count`, no "end to end"/"ship"/"full" keyword) can classify as trivial and dispatch zero specialists even with `requested_strategy: "orchestrated"`, while `routePath` still shows the specialist a *focused* classification would have picked, for display purposes. Read `specialists`/`tasks`, not `routePath`, to know what actually ran.

Pass `candidates` to route pre-retrieved artifacts to specialists as role-aware context (D3). The caller does retrieval up front; each dispatched specialist's prompt then carries a trust-wrapped `## Role context` section holding only the artifact kinds its role policy prefers, within a token budget — a `target-file` reaches the engineer, a `prd` the product-manager, and a kind on a role's avoid list never reaches it. A `kind: "skill"` candidate is dropped for any role not entitled to that skill. The candidate list is snapshotted on the run, so a `provider`-executed and a `host`-executed task materialize the same context bytes. Omit `candidates` for no injected context (byte-identical to a pre-D3 prompt).

| Parameter | Type | Description |
|---|---|---|
| `request` | string | **required** — Natural-language description of the work to orchestrate. |
| `workflow_type` | string | Optional workflow type to shape the plan (e.g. architecture-review). |
| `requested_strategy` | string | `orchestrated` \| `prompt-only` \| `auto` (default auto). |
| `worker_backend` | string | `host` materializes prompts for the calling MCP host to execute (default for MCP-originated runs); `provider` executes against a configured provider key; `inline` prepares only. |
| `host` | string | Host/IDE identifier (advisory). |
| `host_model` | string | Model the host uses, for model resolution. |
| `host_provider` | string | Provider family the host uses, for model resolution. |
| `file_count` | number | Optional planning hint: number of files in scope. Pass this (or `module_count`) when the work has real scope — see the specialists/routePath note above. |
| `module_count` | number | Optional planning hint: number of modules in scope. |
| `context_targets` | array | Optional registered source targets to bind for context (`[{id, role?}]`); an unknown id is rejected at plan time. |
| `candidates` | array | Optional pre-retrieved artifacts routed to specialists as role-aware context (`[{path, title, kind, summary, score?, skillId?}]`). Filtered per role by the context policy; a `kind: "skill"` entry is dropped for any role not entitled to it. |
| `context_budget` | object | Optional `{maxTokens}` cap for the injected role context (default ~6000 tokens per specialist). |
| `wait` | boolean | Wait for a terminal state and return task output (default true); `false` returns the runId to poll. |
| `timeout_ms` | number | Max wait when `wait=true` (default 120000); on timeout the runId is returned to poll. |

### `orchestration_task_result`
Submit one host-executed specialist task result for a run planned with `worker_backend=host` (Phase 1 of the host worker backend, ADR-0063). `orchestration_run` returns each task's materialized prompt without executing it; execute that prompt as the named specialist role, then call this tool with the output. The response carries `next_task` (the next awaiting prompt) or `null` once the run is terminal — loop until `null`. Reachable via the `call` gateway (self-registered, non-core tool). Recorded fields are host-reported (`provenanceSource: 'host-reported'`) — self-reported, never independently verified, and never rendered identically to a `provider`-executed task's shape.

| Parameter | Type | Description |
|---|---|---|
| `run_id` | string | **required** — The run id from `orchestration_run`. |
| `task_id` | string | **required** — The task id this result answers (e.g. `t1`). |
| `output` | string | **required** — The specialist output produced. Must be non-empty. |
| `model` | string | Optional: the model used to execute this task (self-reported). |
| `provider` | string | Optional: the provider/vendor family used (self-reported). |
| `reasoning` | string | Optional: reasoning/thinking for this task, if disclosed. |

### `participation_rules`
Author and inspect ADR-0070 participation rules — condition-driven `when(signals) → recruit(specialists|teams)` declarations with role and gate semantics (construct-pteo2.16). Every action is a thin envelope over `lib/registry/org-api.mjs`, the same writer `construct participation` and Org Studio's participation canvas wrap, so all three surfaces produce identical config writes and identical validation errors. Writes land in the project or user tier only; the builtin tier is refused at the shared org-api layer.

| Parameter | Type | Description |
|---|---|---|
| `action` | string | **required** — One of `list`, `show`, `add`, `validate`, `remove`, `preview`, `meta`. |
| `owner` | string | Owning specialist or team id the rule attaches to (`show`/`add`/`validate`/`remove`). |
| `rule_id` | string | Rule id (`show`/`remove`). |
| `rule` | object | The participation rule (`add`/`validate`), `schemas/participation-rules.schema.json` shape. |
| `request` | string | Sample request text (`preview` — recruited set via the live `requestSignals` + recruiter path). |
| `scope` | string | Write tier for `add`/`remove`: `project` (default) or `user`. |

### `orchestration_readiness`
Report whether this MCP session has Construct orchestration tools attached and reachable now. Returns a pass/fail verdict, typed `reasonCode`, one deterministic `nextStep`, required/observed/missing tools, and a redacted diagnostic bundle. This is an observed attachment check, unlike `construct_execution_resolve`, which remains a descriptive planning/model-resolution contract.

Default required tools are `orchestration_policy` and `orchestration_run`. `orchestration_run` may be either flat or reachable through the `call` gateway enum.

Reason codes: `attached`, `host_not_attached`, `server_unreachable`, `auth_unavailable`, `profile_mismatch`, `capability_negotiation_failed`, `version_mismatch`, `tool_unlisted`, `unknown`.

| Parameter | Type | Description |
|---|---|---|
| `host` | string | Host/IDE identifier, if known. |
| `session_id` | string | Host session/thread id, if known. |
| `observed_tools` | array | Optional tool names observed by the host in `tools/list`. Defaults to this server catalog when called through MCP. |
| `reachable_tools` | array | Optional long-tail tool names reachable through a gateway enum. |
| `required_tools` | array | Required orchestration tools. Defaults to `orchestration_policy`, `orchestration_run`. |
| `client_contract_version` | string | Client contract version for compatibility checks. |
| `observation_scope` | string | `host-session` or `local-config`. MCP calls normally use `host-session`. |

### `orchestration_status`
Inspect orchestration runs: pass `run_id` for the full shaped record (status, per-task status/executor/output/error), or omit it for a list of recent runs. Solo runs are in-process (no daemon); a remote/team orchestration service is opt-in via `CONSTRUCT_ORCHESTRATION_URL`, and only that path can be unreachable.

| Parameter | Type | Description |
|---|---|---|
| `run_id` | string | Run id to fetch. Omit to list recent runs. |
| `limit` | number | Max runs to list when `run_id` is omitted (default 20). |

### `orchestration_cancel`
Request cancellation of an in-progress orchestration run by `run_id`. A soft, cooperative cancel: the run stops cleanly before its next task (an in-flight model call is not aborted), and the request is persisted on the run so a run executing in another process observes it. Returns an error for an unknown or already-terminal run.

| Parameter | Type | Description |
|---|---|---|
| `run_id` | string | **required** — Run id to cancel. |
### `list_worker_profiles`

Lists canonical Worker Profiles available from the registry.

### `get_worker_profile`

Reads one canonical Worker Profile by id.

### `list_procedures`

Lists canonical Procedures available from the registry.

### `get_procedure`

Reads one canonical Procedure by id.

### `list_capabilities`

Lists canonical capabilities available from the registry.

### `get_capability`

Reads one canonical capability by id.

### `list_policies`

Lists canonical policies available from the registry.

### `get_policy`

Reads one canonical policy by id.

### `construct_trace`

Reads Construct execution trace records.

### `construct_score`

Reads Construct outcome scores.

### `construct_trace_update`

Appends an update to a Construct trace record.
