<!--
docs/reference/mcp-tools.md — Every MCP tool exposed by the Construct MCP server.

Source: lib/mcp/server.mjs. Tools are registered across 7 modules:
project, document, storage, skills, workflow, telemetry, memory.
Total: ~40 tools.
-->

# MCP Tools Reference

Construct exposes a Model Context Protocol (MCP) server consumed by Claude Code, OpenCode, and any other MCP-compatible host. Tools are registered in `lib/mcp/server.mjs` and implemented across `lib/mcp/tools/`.

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
Returns project context: `.cx/context.md` content, recent commits, and working tree status.

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

### `infer_document_schema`
Infers a structured field schema from a document (or reconciles across multiple documents).

| Parameter | Type | Description |
|---|---|---|
| `file_path` | string | Single document path |
| `file_paths` | string[] | Multiple documents for unified schema inference |
| `max_chars` | number | Max chars to send to the model (default: 40,000) |
| `save` | boolean | Write schema as `.schema.json` under `.cx/knowledge/reference/schemas/` |
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
| `confirm` | boolean | **Required** — must be `true` |

### `delete_ingested_artifacts`
Deletes ingested markdown artifacts. Requires explicit `confirm: true`.

| Parameter | Type | Description |
|---|---|---|
| `cwd` | string (optional) | Project directory |
| `files` | string[] (optional) | Relative file paths under `.cx/knowledge/`. Omit to delete all. |
| `confirm` | boolean | **Required** — must be `true` |

---

## Skills tools

### `list_skills`
Lists all available categories and playbooks in the Construct knowledge base.

### `get_skill`
Reads a specific skill playbook from the knowledge base.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | Relative path to the skill (without `.md` extension, e.g. `security/security-arch`) |

### `search_skills`
Searches for a pattern within the Construct knowledge base skills.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | Yes | Regex pattern to search for |

### `get_template`
Reads a doc template by name. Resolves `.cx/templates/docs/{name}.md` first, then `templates/docs/{name}.md`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Template name without `.md` extension (e.g. `prd`, `adr`, `runbook`) |

### `list_templates`
Lists shipped and project-override doc templates.

### `agent_contract`
Looks up agent-to-agent service contracts from `agents/contracts.json`.

| Parameter | Type | Description |
|---|---|---|
| `id` | string (optional) | Exact contract id (e.g. `architect-to-engineer`) |
| `producer` | string (optional) | Producer agent name — returns outgoing contracts |
| `consumer` | string (optional) | Consumer agent name — returns incoming contracts |

### `orchestration_policy`
Classifies a request into intent, execution track, specialists, and approval boundaries.

| Parameter | Type | Description |
|---|---|---|
| `request` | string | User request or objective text |
| `fileCount` | number | Approximate number of files involved |
| `moduleCount` | number | Approximate number of modules involved |
| `introducesContract` | boolean | Whether the change introduces a new contract |
| `explicitDrive` | boolean | Whether drive/full-send mode is active |
| `approval` | object | Approval-boundary flags (`scopeChange`, `productDecision`, `riskAcceptance`, etc.) |

### `list_teams`
Lists all available team templates with members, focus, and promotion gates.

### `get_team`
Returns the full definition of a named team template.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Team template name (e.g. `feature`, `incident`, `architecture`) |

---

## Telemetry tools

### `cx_trace`
Records an agent trace in Langfuse. Call at the start of every significant task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Agent name (e.g. `cx-engineer`) |
| `id` | string | No | Trace UUID (auto-generated if omitted) |
| `session_id` | string | No | Session ID to group related spans |
| `metadata` | object | No | Extra metadata |
| `input` | string or object | No | Agent goal or user request |
| `output` | string or object | No | Agent deliverable or response |

Returns: `{ trace_id }` — pass to `cx_score` and `cx_trace_update`.

### `cx_trace_update`
Updates an existing Langfuse trace with output and metadata.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `trace_id` | string | Yes | Trace ID from `cx_trace` |
| `output` | string or object | No | Final output |
| `metadata` | object | No | Additional metadata to merge |

### `cx_score`
Attaches a quality score to a trace in Langfuse.

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
