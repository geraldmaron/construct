<!--
docs/reference/config.md — Every environment variable and config key for Construct.

Sensitive values live in ~/.construct/config.env (mode 0600). Non-sensitive
project values go in .cx/env. Source: lib/env-config.mjs and individual modules.
-->

# Configuration Reference

Construct is configured through environment variables. Sensitive values live in `~/.construct/config.env` (mode 0600); non-sensitive project values can go in `.cx/env`.

Config is loaded in this order (last write wins): repo `.env` → `~/.construct/config.env`. The MCP server and hooks call `loadConstructEnv()` at startup so the values in `config.env` are authoritative even if the shell environment differs.

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
| `CONSTRUCT_DEPLOYMENT_MODE` | `solo` | `solo` \| `team` \| `enterprise` — selects backends for the intake queue, memory, workers, and MCP broker. Read at runtime by `lib/deployment-mode.mjs`. Set via `construct config mode <m>`. |

## Intake queue

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_INTAKE_QUEUE_BACKEND` | — | `filesystem` \| `postgres` override. Wins over `CONSTRUCT_DEPLOYMENT_MODE`. Useful for testing the Postgres adapter from solo mode (requires `DATABASE_URL`). |
| `CONSTRUCT_PROJECT_NAME` | basename of CWD | Project scope for Postgres-backed intake queue rows. |
| `CONSTRUCT_TENANT_ID` | — | Tenant scope for enterprise mode. Filters `construct_intake_items` queries. |
| `CONSTRUCT_DEBUG_INTAKE` | — | `1` to log daemon-side intake preparation failures to stderr (non-fatal otherwise). |

## MCP broker

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_MCP_BROKER` | — | `on` \| `off` — override default broker engagement. Otherwise the broker is on in team / enterprise and off in solo. |

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
| `CONSTRUCT_EMBEDDING_FALLBACK` | — | `1` to silently fall back to `local-onnx` when `openai` key missing |
| `OPENAI_API_KEY` | — | Required when `CONSTRUCT_EMBEDDING_MODEL=openai` |

## Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/construct`) |
| `CONSTRUCT_DATABASE_URL` | Alias for `DATABASE_URL` |

## Providers

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub personal access token. Alias: `GH_TOKEN`. Without this, unauthenticated rate limits apply (60 req/h). |
| `GH_TOKEN` | Alias for `GITHUB_TOKEN` — checked when `GITHUB_TOKEN` is absent |
| `GITHUB_REPOS` | Comma-separated `owner/repo` list surfaced as provider source hints at session start |
| `JIRA_BASE_URL` | Atlassian Jira base URL (e.g. `https://yourorg.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email — used for Basic auth |
| `JIRA_API_TOKEN` | Jira API token (from id.atlassian.com/manage-profile/security/api-tokens) |
| `CONFLUENCE_BASE_URL` | Confluence base URL — defaults to `JIRA_BASE_URL` if unset |
| `CONFLUENCE_EMAIL` | Confluence account email — defaults to `JIRA_EMAIL` if unset |
| `CONFLUENCE_API_TOKEN` | Confluence API token — defaults to `JIRA_API_TOKEN` if unset |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | Slack user token (`xoxp-...`) — required for `search.messages` |
| `SALESFORCE_INSTANCE_URL` | Salesforce instance URL (e.g. `https://yourorg.my.salesforce.com`) |
| `SALESFORCE_ACCESS_TOKEN` | Salesforce OAuth access token (bearer) |

## Telemetry & Tracing

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_TRACE_BACKEND` | `langfuse` | Trace backend (`langfuse` or `none`) |
| `LANGFUSE_BASEURL` | `https://cloud.langfuse.com` | Langfuse endpoint |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse project secret key |

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

## Model router

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key — enables free model fallback when primary provider is down |
| `ANTHROPIC_API_KEY` | Anthropic key for Claude model calls |
| `OPENAI_API_KEY` | OpenAI key — used for OpenAI model tier or openai embedding model |

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
