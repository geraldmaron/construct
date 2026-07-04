<!--
docs/guides/reference/config.md: Every environment variable and config key for Construct.

Sensitive values live in the XDG config dir config.env (mode 0600). Source:
lib/config/xdg.mjs, lib/env-config.mjs, lib/config/project-config.mjs and
individual modules.
-->

# Configuration Reference

Construct follows a strict **Secrets vs. State** boundary for configuration, aligned with the [12-Factor App](https://12factor.net/config) principles.

## User-scope layout (XDG)

User-scope files follow the [XDG Base Directory specification](https://specifications.freedesktop.org/basedir-spec/latest/), split across three roots so config, state, and cache can be backed up and pruned independently. Each root honors its `$XDG_*_HOME` env var when the value is an **absolute** path, otherwise the default applies (a relative or empty value is ignored). Resolved by `lib/config/xdg.mjs`.

| Root | Env var | Default | Holds |
|---|---|---|---|
| **config** | `$XDG_CONFIG_HOME` | `~/.config/construct` | `config.env`, `providers.json`, `embed.yaml`, `features.json`, `claude-ai-mcps.json`, `custom-credentials.json`, `provider-subscriptions.json`, `auth/`, `boundary.json`, `config.json`, `plugins.json`, the `lib` hook symlink |
| **state** | `$XDG_STATE_HOME` | `~/.local/state/construct` | `vector/lancedb`, `doctor.json`, `dashboard.json`, `workspace/`, `runtime/`, `bin/`, `intake-daemon.heartbeat`, `.cleanup-stamp` |
| **cache** | `$XDG_CACHE_HOME` | `~/.cache/construct` | `cache/embeddings`, `.runtime`, regenerable transients |

> **Upgrade — clean break.** There is no read or migration of a legacy `~/.construct/*` tree. After upgrading, run `construct install --scope=user` once to repopulate the user-scope files at the XDG paths. `construct doctor` flags a missing user config until you do.

## Config tiers and precedence

Project configuration has two file tiers, most-specific wins:

| Tier | File | Committed? | Merge rule |
|---|---|---|---|
| project-local | `construct.config.local.json` | No (gitignored) | merges **over** the committed config |
| project | `construct.config.json` | Yes | base for the local overlay |

When both exist, list-shaped settings (e.g. `sources.targets`, `intakePolicy.additionalDirs`, permission allowlists) **merge and dedupe** — object entries collapse on their `id` so a local re-declaration replaces the committed entry rather than duplicating it; scalars and objects **override** key-by-key. The local overlay is validated against the same schema (partial allowed — no `version` required).

Full resolution order for a single setting (most-specific wins): **env var (if set) ▷ project-local config ▷ project config ▷ default**.

## `.env` precedence and shadow warnings

Environment values are loaded by `lib/env-config.mjs` from three sources, most-specific wins: **project `.env` ▷ user `config.env` (XDG config dir) ▷ shell exports**. A repo's local `.env` is closer to the work than a machine-wide default, so it takes the file-tier precedence. (Materialized `op run` credentials injected into `process.env` still win over stored `op://` references so one 1Password unlock per invocation is enough.)

When a key is defined in **both** the project `.env` and the user `config.env` with different values, Construct prints a one-time shadow warning to stderr naming the key and the winning file, so a stale per-machine default is never silently authoritative. Remove the key from one file to silence it.

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
| `HOME` | system | Base for the XDG user dirs (`~/.config/construct`, `~/.local/state/construct`, `~/.cache/construct`) and `~/.cx/` |
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
| `orchestration.store` | `filesystem` | `filesystem` \| `sqlite` \| `postgres`, or a registered `kind:"storage"` extension manifest whose `operations.runStore` maps to one of those implementations. Explicit missing backends degrade visibly to filesystem with `requestedBackend`/`degradedReason`; they are not silently ignored. |
| `orchestration.chainOfThought` | `hidden` | Disclosure of a provider-executed specialist's reasoning. `hidden`: reasoning is not requested or shown. `surface`: reasoning is requested (Anthropic extended thinking / OpenRouter `reasoning`) and attached to each task, so `construct orchestrate run`/`status`, the `orchestration_run` MCP tool, and the dashboard event stream display it. `telemetry_only`: reasoning is requested and written to the run trace (`.cx/traces/*.jsonl` `worker.completed` metadata) but never displayed. Inline runs never produce reasoning. See ADR-0030. |

## Models (catalog visibility)

Keys under `models` in `construct.config.json`. Consumed by `lib/models/catalog.mjs` and `getProviderModelCatalog()` in `lib/model-router.mjs`. Tier **assignments** (reasoning/standard/fast primaries) remain in `specialists/org` and emergency overrides in `CX_MODEL_*` env vars — highest precedence unchanged.

| Key | Default | Description |
|---|---|---|
| `models.visibility.mode` | `tier_defaults` | `tier_defaults` — registry tier primaries + fallbacks only; `all_configured` — tier defaults plus a capped free OpenRouter slice; `explicit` — `models.visibility.include` allowlist only. |
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

### Tier-default registry (`specialists/org/models.json`)

Operators may bind tier defaults in an optional `specialists/org/models.json` under the toolkit dir (`CX_TOOLKIT_DIR`, else the installed package root). Each of `reasoning`/`standard`/`fast` is a bare model-id string or `{ "primary": id, "fallback": [ids] }` (resolution uses the primary). The embedded resolver (`resolveEmbeddedModel`) reads it automatically — no config flag.

Resolution precedence for a tier, most-specific first:

1. `CX_MODEL_<TIER>` / `CONSTRUCT_MODEL_<TIER>` env pin — **always wins**.
2. `specialists/org/models.json` registry tier — fills only tiers no env pin sets (`resolutionSource: tier-default`, `tierSource: registry`).
3. Credential-derived provider-family default — see AP3 credential fallback.
4. `config-error` — no implicit defaults (ADR-0027): an unconfigured machine degrades honestly rather than resolving a model whose credentials may be absent.

Construct ships **no active** `models.json`; copy the shipped `specialists/org/models.json.example` to activate it.

Deprecated: `CONSTRUCT_MODEL_*` env vars — use `CX_MODEL_*` (alias still honored for one release cycle).

Typed integration selectors under `sources.targets`. Consumed by embed auto-discovery (when `embed.yaml` is absent), `provider_fetch`, and session-start source hints. Legacy env lists merge additively; an explicit `embed.yaml` in the XDG config dir remains a complete override.

```json
{
  "sources": {
    "targets": [
      { "id": "gh-main", "provider": "github", "selector": { "repo": "org/repo" } },
      { "id": "jira-plat", "provider": "jira", "selector": { "project": "PLAT" } },
      { "id": "linear-eng", "provider": "linear", "selector": { "team": "ENG" } },
      { "id": "slack-incidents", "provider": "slack", "selector": { "channel": "incidents", "intent": "risk" } }
    ]
  }
}
```

CLI: `construct sources list`, `construct sources add <provider> <id> '<selector-json>'`, `construct sources remove <id>`, `construct sources validate`.

| Env (legacy merge) | Maps to |
|---|---|
| `GITHUB_REPOS` | GitHub `selector.repo` entries |
| `JIRA_PROJECTS` | Jira `selector.project` entries |
| `LINEAR_TEAMS` | Linear `selector.team` entries |
| `SLACK_CHANNELS` | Slack `selector.channel` (+ optional `:intent`) |

## Intake policy (`construct.config.json`)

Filesystem inbox watcher depth and extra directories under `intakePolicy`. A legacy `.cx/intake-config.json` is read as a warned fallback for `maxDepth` and `additionalDirs` only.

The single canonical drop zone is `inbox/` at the project root (ADR-0045 §C) — always watched. There are no other zones: `.cx/inbox/` and `docs/intake/` are not watched and not scaffolded. Machine/runtime intake state (pending, processed, skipped, quarantine, dead-letter) stays under the gitignored `.cx/intake/`.

| Key | Default | Description |
|---|---|---|
| `intakePolicy.maxDepth` | `4` | Subdirectory scan depth per watched directory |
| `intakePolicy.additionalDirs` | `[]` | Extra directories to watch beyond `inbox/` (opt-in only) |

**Drop convention (atomic handoff).** Writers assemble a file under `inbox/.staging/` (gitignored) and then atomically `rename` it into `inbox/`. The watcher enqueues only complete top-level files: it ignores dotfiles and `inbox/.staging/`, and skips any file whose size is still changing between two stats, so a partially-written drop is never consumed. Processed items move to `.cx/intake/processed/`.

Env overrides: `CX_INBOX_DIRS` (colon-separated paths), `CX_INTAKE_MAX_DEPTH`.

## Intake queue

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_INTAKE_QUEUE_BACKEND` | mode default | `filesystem` \| `git` \| `postgres` override. Wins over `CONSTRUCT_DEPLOYMENT_MODE`. `postgres` is explicit opt-in and requires `DATABASE_URL`/`CONSTRUCT_DATABASE_URL`; it does not silently downgrade. |
| `CONSTRUCT_PROJECT_NAME` | basename of CWD | Project scope for Postgres-backed intake queue rows. |
| `CONSTRUCT_INTAKE_QUEUE_NAME` | `intake` | Logical queue name for the Postgres queue provider. |
| `CONSTRUCT_QUEUE_LEASE_SECONDS` | `120` | Claim lease duration for the Postgres queue provider before an unhearted claim is reclaimable. |
| `CONSTRUCT_TENANT_ID` | `local` outside enterprise | Tenant scope for enterprise mode and Postgres queue rows. |
| `CONSTRUCT_DEBUG_INTAKE` | unset | `1` to log daemon-side intake preparation failures to stderr (non-fatal otherwise). |

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
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/construct`). When set with the optional `postgres` package installed, `construct db status` probes the connection and Postgres run-store/queue selection can use it. |
| `CONSTRUCT_DATABASE_URL` | Alias for `DATABASE_URL` used by Construct-specific launch environments. |
| `CONSTRUCT_DB_MAX_CONNECTIONS` | Optional Postgres.js pool size override for Construct SQL clients; default `5`. |
| `CONSTRUCT_DB_IDLE_TIMEOUT_SECONDS` | Optional Postgres.js idle timeout; default `20`. |
| `CONSTRUCT_DB_CONNECT_TIMEOUT_SECONDS` | Optional Postgres.js connect timeout; default `10`. |
| `CONSTRUCT_DB_SSL` | Optional Postgres.js SSL mode (`false`, `true`, `require`, `prefer`, `verify-full`). |

Run `construct db migrate` to apply Construct-owned Postgres migrations idempotently; `construct db status --json` reports connection and migration state without printing credentials. Queue tables are namespaced by `project`, `tenant_id`, and `queue_name`; claims use `FOR UPDATE SKIP LOCKED` plus lease expiry so a crashed worker's item becomes reclaimable.

## Providers

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub personal access token. Alias: `GH_TOKEN`. Without this, unauthenticated rate limits apply (60 req/h). |
| `GH_TOKEN` | Alias for `GITHUB_TOKEN`: checked when `GITHUB_TOKEN` is absent |

### 1Password (`op://`) credentials

Store provider keys in `config.env` (the XDG config dir, default `~/.config/construct/config.env`) as `op://vault/item/field` references (or plain values). Construct resolves them lazily via `op read` when a model call needs the plaintext.

**Recommended (one auth for the whole dev tree):** point Construct at a shared `op run` env file and let it resolve once. Set `CONSTRUCT_OP_ENV_FILE` in `config.env`:

```bash
# ~/.config/construct/config.env
CONSTRUCT_OP_ENV_FILE=~/.config/claude/.env.op
```

With that set and `op` installed, `construct dev` re-execs itself once under a single `op run --env-file …`, so every `op://` reference resolves one time (one biometric unlock) and every detached daemon inherits the resolved keys. You do not need to wrap the CLI by hand.

`op run` masks secrets in the wrapped process output by default. Because the daemons are detached and write their own log files, that masking covers the `construct dev` process output but not the daemon logs (local-only, under the state dir) — see [ADR-0049](https://github.com/geraldmaron/construct/blob/main/docs/decisions/adr/0049-cross-process-auth-once.md). For a standalone tool you can still wrap manually — `op run --env-file="$HOME/.config/claude/.env.op" -- opencode` — with masking on.

When `op run` injects materialized keys into `process.env`, Construct keeps those values instead of overwriting them with stored `op://` refs from `config.env`. Override the env-file location with `CONSTRUCT_OP_ENV_FILE` and the wrapped binary with `CONSTRUCT_BIN`.
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
| `CONSTRUCT_ORCHESTRATION_URL` | _(unset)_ | Point `orchestration_run`/`orchestration_status` at a remote/team orchestration service over HTTP. Unset = in-process (solo default — no daemon, no port, no token). |
| `CONSTRUCT_ORCHESTRATION_TOKEN` | _(unset)_ | Bearer token for the remote orchestration service (falls back to `CONSTRUCT_DASHBOARD_TOKEN`). |

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
| `GITHUB_TOKEN` | GitHub PAT for integrations; may be a plain value or `op://` reference |
| `CONSTRUCT_OP_ENV_FILE` | Override path for the 1Password env file used by a local `op run` wrapper (default on this machine: `~/.config/claude/.env.op`) |
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

Each optional resource stores operator consent in `config.env` (the XDG config dir) via a `BOOTSTRAP_<RESOURCE>` key (values: `yes`, `never`, blank = not yet asked).

| Key | Resource |
|---|---|
| `BOOTSTRAP_POSTGRES` | PostgreSQL + pgvector (Docker container) |
| `BOOTSTRAP_EMBEDDING_MODEL` | Local ONNX embedding model (~50 MB) |
