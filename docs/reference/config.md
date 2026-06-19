<!--
docs/reference/config.md: Every environment variable and config key for Construct.

Sensitive values live in ~/.construct/config.env (mode 0600). Non-sensitive
project values go in .cx/env. Source: lib/env-config.mjs and individual modules.
-->

# Configuration Reference

Construct follows a strict **Secrets vs. State** boundary for configuration, aligned with the [12-Factor App](https://12factor.net/config) principles.

## The Boundary: Env vs. Config

| Storage | Purpose | Shared? | Examples |
|---|---|---|---|
| **`.env`** | Secrets, API keys, and machine-specific local overrides. | No (Gitignored) | `ANTHROPIC_API_KEY`, `PORT`, `DATABASE_URL` |
| **`construct.config.json`** | Shared, versioned project state and orchestration strategy. | Yes (Committed) | `deployment.mode`, `telemetry.enabled`, `orchestration.chainOfThought` |

### Secret Interpolation
To keep secrets out of the committed configuration file while still maintaining a central control plane, `construct.config.json` supports **Environment Variable Interpolation**. Any string value starting with `$` is replaced with the corresponding environment variable at runtime.

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "$ANTHROPIC_API_KEY"
    }
  }
}
```

## Discoverability & Schema

The `construct.config.json` file is scaffolded with a `"$schema"` property. In supported editors (like VS Code or IntelliJ), this provides:
*   **Auto-completion**: Suggestions for all valid configuration keys.
*   **Documentation**: Hover over any key to see its purpose and available options.
*   **Validation**: Immediate feedback if a value is invalid (e.g., a typo in `deployment.mode`).

---

## Core

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4242` | Dashboard HTTP port |
| `BIND_HOST` | `127.0.0.1` | Dashboard bind address |
| `NODE_ENV` | `development` | `production` disables stack traces in responses |
| `HOME` | system | Used to resolve `~/.construct/` and `~/.cx/` paths |
| `CX_DATA_DIR` | `$HOME` | Override root for `.cx/` data directories |

## Deployment mode

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_DEPLOYMENT_MODE` | `solo` | `solo` \| `team` \| `enterprise`: selects backends for the intake queue, memory, workers, and MCP broker. Read at runtime by `lib/deployment-mode.mjs`. Set via `construct config mode <m>`. |

## Orchestration

Keys under `orchestration` in `construct.config.json`. Read at runtime by `lib/orchestration/runtime.mjs`.

| Key | Default | Description |
|---|---|---|
| `orchestration.workerBackend` | `inline` | `inline` (plan and prepare specialist tasks, no model call) \| `provider` (execute each task against the configured model). |
| `orchestration.store` | `filesystem` | `filesystem` \| `sqlite` \| `postgres`: where run and task-graph state is persisted. |
| `orchestration.chainOfThought` | `hidden` | Disclosure of a provider-executed specialist's reasoning. `hidden`: reasoning is not requested or shown. `surface`: reasoning is requested (Anthropic extended thinking / OpenRouter `reasoning`) and attached to each task, so `construct orchestrate run`/`status`, the `orchestration_run` MCP tool, and the dashboard event stream display it. `telemetry_only`: reasoning is requested and written to the run trace (`.cx/traces/*.jsonl` `worker.completed` metadata) but never displayed. Inline runs never produce reasoning. See ADR-0030. |

## Models (catalog visibility)

Keys under `models` in `construct.config.json`. Consumed by `lib/models/catalog.mjs` and `getProviderModelCatalog()` in `lib/model-router.mjs`. Tier **assignments** (reasoning/standard/fast primaries) remain in `specialists/registry.json` and emergency overrides in `CX_MODEL_*` env vars — highest precedence unchanged.

| Key | Default | Description |
|---|---|---|
| `models.visibility.mode` | `all_configured` | `all_configured` — all models from configured providers; `tier_defaults` — registry tier primaries + fallbacks only; `explicit` — `models.visibility.include` allowlist only (active chat pin always shown). |
| `models.visibility.include` | `[]` | Model ids shown when `mode` is `explicit`. |
| `models.visibility.exclude` | `[]` | Hidden from pickers; pinned model outside visibility shows a warning. |
| `models.visibility.providers` | `{}` | Per provider-family toggles (`openrouter`, `github-copilot`, …); `false` hides the family. |
| `models.catalog.liveOpenRouter` | `true` | Merge cached live OpenRouter free models into the catalog (`~/.cx/model-catalog-cache.json`, 10 min TTL). |
| `models.catalog.maxLiveFree` | `24` | Cap on live free models merged from cache. |

CLI:

```bash
construct config set models.visibility.mode explicit
construct config set models.visibility.include '["anthropic/claude-sonnet-4-6"]'
construct models list
construct models list --json
```

Deprecated: `CONSTRUCT_MODEL_*` env vars — use `CX_MODEL_*` (alias still honored for one release cycle).

## Intake queue

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_INTAKE_QUEUE_BACKEND` |: | `filesystem` \| `postgres` override. Wins over `CONSTRUCT_DEPLOYMENT_MODE`. Useful for testing the Postgres adapter from solo mode (requires `DATABASE_URL`). |
| `CONSTRUCT_PROJECT_NAME` | basename of CWD | Project scope for Postgres-backed intake queue rows. |
| `CONSTRUCT_TENANT_ID` |: | Tenant scope for enterprise mode. Filters `construct_intake_items` queries. |
| `CONSTRUCT_DEBUG_INTAKE` |: | `1` to log daemon-side intake preparation failures to stderr (non-fatal otherwise). |

## MCP broker

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_MCP_BROKER` | (| `on` \| `off`) override default broker engagement. Otherwise the broker is on in team / enterprise and off in solo. |

## Authentication

| Variable | Description |
|---|---|
| `CONSTRUCT_DASHBOARD_TOKEN` | Bearer token for single-token dashboard auth (simple path) |
| `CONSTRUCT_DASHBOARD_ORIGINS` | Comma-separated CORS origin allowlist (e.g. `http://localhost:4242`) |
| `CONSTRUCT_AUTO_INSTALL` | `1` to auto-install optional resources without prompting (CI use) |

## Embedding

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_EMBEDDING_MODEL` | `hashing` | `hashing` (offline), `local-onnx` (384d), `openai` (1536d) |
| `CONSTRUCT_EMBEDDING_FALLBACK` |: | `1` to silently fall back to `local-onnx` when `openai` key missing |
| `OPENAI_API_KEY` |: | Required when `CONSTRUCT_EMBEDDING_MODEL=openai` |

## Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/construct`) |
| `CONSTRUCT_DATABASE_URL` | Alias for `DATABASE_URL` |

## Providers

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub personal access token. Alias: `GH_TOKEN`. Without this, unauthenticated rate limits apply (60 req/h). |
| `GH_TOKEN` | Alias for `GITHUB_TOKEN`: checked when `GITHUB_TOKEN` is absent |
| `GITHUB_REPOS` | Comma-separated `owner/repo` list surfaced as provider source hints at session start |
| `JIRA_BASE_URL` | Atlassian Jira base URL (e.g. `https://yourorg.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email: used for Basic auth |
| `JIRA_API_TOKEN` | Jira API token (from id.atlassian.com/manage-profile/security/api-tokens) |
| `CONFLUENCE_BASE_URL` | Confluence base URL: defaults to `JIRA_BASE_URL` if unset |
| `CONFLUENCE_EMAIL` | Confluence account email: defaults to `JIRA_EMAIL` if unset |
| `CONFLUENCE_API_TOKEN` | Confluence API token: defaults to `JIRA_API_TOKEN` if unset |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | Slack user token (`xoxp-...`): required for `search.messages` |
| `SALESFORCE_INSTANCE_URL` | Salesforce instance URL (e.g. `https://yourorg.my.salesforce.com`) |
| `SALESFORCE_ACCESS_TOKEN` | Salesforce OAuth access token (bearer) |

## Telemetry & Tracing

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_TRACE_BACKEND` | `local` | Trace backend: `local`, `langfuse`, `http`, `otel`, or `none`. Legacy `remote` resolves to `langfuse` when keys are present, otherwise `http` when a URL is set. |
| `CONSTRUCT_TELEMETRY_URL` |: | Langfuse-compatible or generic HTTP ingestion endpoint |
| `CONSTRUCT_TELEMETRY_PUBLIC_KEY` |: | Langfuse-compatible public key |
| `CONSTRUCT_TELEMETRY_SECRET_KEY` |: | Langfuse-compatible secret key |
| `CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT` |: | OTLP HTTP collector endpoint used when `CONSTRUCT_TRACE_BACKEND=otel` |
| `CONSTRUCT_TELEMETRY_PROVIDER` | derived | Optional display label for dashboard/status |

## MCP

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_MCP_HTTP` | `0` | `1` to enable HTTP MCP transport (requires dashboard token) |

## Logging

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_LOG_LEVEL` | `info` | Log verbosity: `debug` \| `info` \| `warn` \| `error` |
| `CONSTRUCT_LOG_PRETTY` | `0` | `1` for human-readable output instead of JSONL |

## Memory

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_MEMORY` | `on` | Set to `off` to disable memory injection for a session. Stats still recorded. |

## Session & drop zone

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_DROP_DIRS` | `~/Downloads:~/Desktop:~/Documents` | Colon-separated dirs watched by `construct drop` |
| `CONSTRUCT_HOOK_OUTPUT_MODE` | `auto` | SessionStart context routing: `auto` \| `silent` \| `stderr` \| `stdout`. `auto` keeps the rich payload on stdout for interactive sessions and suppresses it (to `~/.cx/session-start-last.log`) for non-interactive ones. Mirrors `hooks.outputMode` in `construct.config.json` (env wins). Set to `silent`/`stderr` from SDK / `claude -p` / automation callers so a one-shot command's stdout stays reserved for its own output. |
| `CONSTRUCT_NONINTERACTIVE` | : | Set truthy (`1`) by an SDK / automation caller to mark the invocation non-interactive, so `CONSTRUCT_HOOK_OUTPUT_MODE=auto` resolves to suppressed. Claude Code exposes no reliable in-hook interactive/print signal, so this flag (or `CI=true` / `NODE_ENV=test`) is how `auto` detects non-interactive mode. |

## Model router

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key: enables free model fallback when primary provider is down |
| `ANTHROPIC_API_KEY` | Anthropic key for Claude model calls |
| `OPENAI_API_KEY` | OpenAI key: used for OpenAI model tier or openai embedding model |
| `CX_MODEL_REASONING` | Override the reasoning-tier model id |
| `CX_MODEL_STANDARD` | Override the standard-tier model id |
| `CX_MODEL_FAST` | Override the fast-tier model id |
| `CONSTRUCT_MODEL_PROFILE` | Optional runtime profile. `small` enables tighter prompt budgets, compressed overlays, and retrieval-first prompt shaping for smaller local or cost-constrained models; `balanced` keeps the default posture. |
| `OLLAMA_BASE_URL` | Base URL for the Ollama HTTP API. `OLLAMA_HOST` remains accepted as a legacy alias. |

## Deprecations & Debug

| Variable | Description |
|---|---|
| `CONSTRUCT_DEPRECATIONS` | `error` to throw instead of warn on deprecated API usage (useful in CI) |
| `CONSTRUCT_DEV_PATH` | Absolute path to a Construct checkout; `.construct/run.mjs` resolves this first |
| `CX_AUTO_EMBED` | `1` to auto-start the embed daemon when provider credentials are present |
| `CX_WORKSPACE` | Override working directory for embed mode |
| `CX_TOOLKIT_DIR` | Override the path where Construct looks for its own toolkit (skills, agents, templates) |

## Bootstrap resource consent

Each optional resource stores operator consent in `~/.construct/config.env` via a `BOOTSTRAP_<RESOURCE>` key (values: `yes`, `never`, blank = not yet asked).

| Key | Resource |
|---|---|
| `BOOTSTRAP_POSTGRES` | PostgreSQL + pgvector (Docker container) |
| `BOOTSTRAP_EMBEDDING_MODEL` | Local ONNX embedding model (~50 MB) |
