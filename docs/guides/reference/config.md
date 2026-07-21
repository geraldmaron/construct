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

Construct stores user configuration at the XDG paths below. Run `construct install --footprint=user` to create them.

## Config tiers and precedence

Project configuration has two file tiers, most-specific wins:

| Tier | File | Committed? | Merge rule |
|---|---|---|---|
| project-local | `construct.config.local.json` | No (gitignored) | merges **over** the committed config |
| project | `construct.config.json` | Yes | base for the local overlay |

When both exist, list-shaped settings (e.g. `sources.targets`, `intakePolicy.additionalDirs`, permission allowlists) **merge and dedupe** — object entries collapse on their `id` so a local re-declaration replaces the committed entry rather than duplicating it; scalars and objects **override** key-by-key. The local overlay is validated against the same schema (partial allowed — no `version` required).

Full resolution order for a single setting (most-specific wins): **env var (if set) ▷ project-local config ▷ project config ▷ default**.

Both config files are **JSONC** — authored like `tsconfig.json`. `//` line comments, `/* … */` block comments, and a trailing comma are all tolerated (parsed by `lib/jsonc.mjs`), so you can keep piped-option hints inline. `construct init` scaffolds `construct.config.json` with commented stubs for the switchable settings (`deployment.mode`: `solo` | `team` | `enterprise`; `deployment.mcpBroker`: `auto` | `on` | `off`). Comments are stripped on load, so a commented stub never becomes a live value; an uncommented value that fails schema validation (e.g. an out-of-enum `deployment.mode`) surfaces a clear error and the loader falls back to defaults.

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
| `HOME` | system | Base for the XDG user dirs (`~/.config/construct`, `~/.local/state/construct`, `~/.cache/construct`) and `~/.construct/` |
| `CONSTRUCT_DATA_DIR` | `$HOME` | Override root for Construct data directories |

## Deployment mode

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_DEPLOYMENT_MODE` | `solo` | `solo` \| `team` \| `enterprise`: selects backends for the intake queue, memory, workers, and MCP broker. Read at runtime by `lib/deployment-mode.mjs`. Set via `construct config mode <m>`. |

### Project identity

Every subsystem that keys state by "which project is this" (`~/.construct/projects/<key>/`, Postgres run/trace/memory rows) resolves the same id via `lib/state-root.mjs`'s `deriveProjectKey`: a hash of the git origin remote, or a hash of the canonical project path when there is no remote (ADR-0092).

| Key | Default | Description |
|---|---|---|
| `deployment.projectKey` (`construct.config.json`) | `null` | Explicit override for the project identity key. Wins over the computed derivation everywhere state is keyed — use it for a monorepo's sub-projects sharing one git remote, a fork that should not inherit the origin's accumulated history, or a remote-URL migration where continuity with the old key matters. Distinct from `deployment.projectName`, which is a display name only and is never used to derive identity. |

## Orchestration

Keys under `orchestration` in `construct.config.json`. Read at runtime by `lib/orchestration/runtime.mjs`.

| Key | Default | Description |
|---|---|---|
| `orchestration.workerBackend` | `inline` (CLI) / `host` (MCP, when unset) | `inline` (plan and prepare Worker Profile Assignments, no model call) \| `provider` (execute each task against a configured provider model — real API spend) \| `host` (materialize each task's prompt for the calling MCP host to execute in its own model session — no API spend; the host submits results via `orchestration_task_result`). An MCP-originated `orchestration_run` call defaults to `host` when neither the tool's `worker_backend` arg nor this key is set; the CLI's own default stays `inline` regardless. `host` over the bare CLI (no attached MCP session) fails loud rather than producing an abandoned run — see ADR-0063. |
| `orchestration.store` | `filesystem` | `filesystem` \| `sqlite` \| `postgres`, or a registered `kind:"storage"` extension manifest whose `operations.runStore` maps to one of those implementations. Explicit missing backends degrade visibly to filesystem with `requestedBackend`/`degradedReason`; they are not silently ignored. |
| `orchestration.chainOfThought` | `hidden` | Disclosure of a provider-executed Worker Profile's reasoning. `hidden`: reasoning is not requested or shown. `surface`: reasoning is requested (Anthropic extended thinking / OpenRouter `reasoning`) and attached to each task, so `construct orchestrate run`/`status`, the `orchestration_run` MCP tool, and the dashboard event stream display it. `telemetry_only`: reasoning is requested and written to the run trace (`.construct/traces/*.jsonl` `worker.completed` metadata) but never displayed. Inline runs never produce reasoning. See ADR-0030. |
| `orchestration.hostExecution` | `auto` | Only meaningful when `workerBackend` resolves to `host`. `auto`: construct-mcp drives the awaiting-host loop itself via MCP sampling (`sampling/createMessage`) when the connected client declared the `sampling` capability at initialize time, otherwise the calling host executes each prompt manually and submits it back (`pickup`). `pickup`: always leave every task for manual pickup, even if the client supports sampling. `sampling`: prefer sampling, falling back to `pickup` if the client never declared the capability. See ADR-0063. |

## Models (catalog visibility)

Keys under `models` in `construct.config.json`. Consumed by `lib/models/catalog.mjs` and `getProviderModelCatalog()` in `lib/model-router.mjs`. Tier **assignments** (reasoning/standard/fast primaries) remain in `registry` and emergency overrides in `CONSTRUCT_MODEL_*` env vars — highest precedence unchanged.

| Key | Default | Description |
|---|---|---|
| `models.visibility.mode` | `tier_defaults` | `tier_defaults` — registry tier primaries + fallbacks only; `all_configured` — tier defaults plus a capped free OpenRouter slice; `explicit` — `models.visibility.include` allowlist only. |
| `models.visibility.include` | `[]` | Model ids shown when `mode` is `explicit`. |
| `models.visibility.exclude` | `[]` | Hidden from pickers; pinned model outside visibility shows a warning. |
| `models.visibility.providers` | `{}` | Per provider-family toggles (`openrouter`, `github-copilot`, …); `false` hides the family. |
| `models.catalog.liveOpenRouter` | `true` | Merge cached live OpenRouter free models into the catalog (`~/.construct/model-catalog-cache.json`, 10 min TTL). |
| `models.catalog.maxLiveFree` | `24` | Cap on live free models merged from cache. |

CLI:

```bash
construct config set models.visibility.mode explicit
construct config set models.visibility.include '["anthropic/claude-sonnet-4-6"]'
construct models list
construct models list --json
```

### Tier-default registry (`registry/models.json`)

Operators may bind tier defaults in an optional `registry/models.json` under the toolkit dir (`CONSTRUCT_TOOLKIT_DIR`, else the installed package root). Each of `reasoning`/`standard`/`fast` is a bare model-id string or `{ "primary": id, "fallback": [ids] }` (resolution uses the primary). The embedded resolver (`resolveEmbeddedModel`) reads it automatically — no config flag.

Resolution precedence for a tier, most-specific first:

1. `CONSTRUCT_MODEL_<TIER>` / `CONSTRUCT_MODEL_<TIER>` env pin — **always wins**.
2. `registry/models.json` registry tier — fills only tiers no env pin sets (`resolutionSource: tier-default`, `tierSource: registry`).
3. Credential-derived provider-family default — see AP3 credential fallback.
4. `config-error` — no implicit defaults (ADR-0027): an unconfigured machine degrades honestly rather than resolving a model whose credentials may be absent.

Construct ships **no active** `models.json`; copy the shipped `registry/models.json.example` to activate it.

Deprecated: `CONSTRUCT_MODEL_*` env vars — use `CONSTRUCT_MODEL_*` (alias still honored for one release cycle).

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

Filesystem inbox watcher depth and extra directories under `intakePolicy`.

The single canonical drop zone is `inbox/` at the project root (ADR-0045 §C) — always watched. There are no other zones: `.construct/inbox/` and `docs/intake/` are not watched and not scaffolded. Machine/runtime intake state (pending, processed, skipped, quarantine, dead-letter) stays under the gitignored `.construct/intake/`.

| Key | Default | Description |
|---|---|---|
| `intakePolicy.maxDepth` | `4` | Subdirectory scan depth per watched directory |
| `intakePolicy.additionalDirs` | `[]` | Extra directories to watch beyond `inbox/` (opt-in only) |

**Drop convention (atomic handoff).** Writers assemble a file under `inbox/.staging/` (gitignored) and then atomically `rename` it into `inbox/`. The watcher enqueues only complete top-level files: it ignores dotfiles and `inbox/.staging/`, and skips any file whose size is still changing between two stats, so a partially-written drop is never consumed. Processed items move to `.construct/intake/processed/`.

Env overrides: `CONSTRUCT_INBOX_DIRS` (colon-separated paths), `CONSTRUCT_INTAKE_MAX_DEPTH`.

## Intake queue

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_INTAKE_QUEUE_BACKEND` | mode default | `filesystem` \| `git` \| `postgres` override. Wins over `CONSTRUCT_DEPLOYMENT_MODE`. Mode defaults are `filesystem` for solo and `postgres` for team/enterprise. `postgres` requires `DATABASE_URL`/`CONSTRUCT_DATABASE_URL`; team/enterprise only fall back to git when `CONSTRUCT_DEGRADED_OK=postgres-queue` is explicitly set. |
| `CONSTRUCT_PROJECT_NAME` | basename of CWD | Project scope for Postgres-backed intake queue rows. |
| `CONSTRUCT_INTAKE_QUEUE_NAME` | `intake` | Logical queue name for the Postgres queue provider. |
| `CONSTRUCT_QUEUE_LEASE_SECONDS` | `120` | Claim lease duration for the Postgres queue provider before an unhearted claim is reclaimable. |
| `CONSTRUCT_TENANT_ID` | `local` outside enterprise | Tenant scope for enterprise mode and Postgres queue rows. |
| `CONSTRUCT_DEBUG_INTAKE` | unset | `1` to log daemon-side intake preparation failures to stderr (non-fatal otherwise). |

## Worker runtime

| Variable | Default | Description |
|---|---|---|
| `CONSTRUCT_WORKER_ID` | `<hostname>:<pid>` | Stable worker identity stored in the Postgres worker registry. |
| `CONSTRUCT_WORKER_TTL_SECONDS` | `120` | Worker heartbeat TTL before `construct workers list` reports the worker as stale. |

## MCP broker

Broker engagement resolves with the same **env ▷ project config ▷ default** precedence as deployment mode (`isBrokered()` in `lib/mcp/broker.mjs`).

| Key | Default | Description |
|---|---|---|
| `CONSTRUCT_MCP_BROKER` (env) | _(unset)_ | `on` \| `off`: overrides broker engagement regardless of config or deployment mode. |
| `deployment.mcpBroker` (`construct.config.json`) | `auto` | `on` \| `off` \| `auto`: `auto` defers to deployment mode (broker on in team/enterprise, off in solo). |

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

**Bare-node (MCP server) context.** The MCP server is launched as bare `node lib/mcp/server.mjs` — no `op run` wrapper — so an `op://` reference resolves via a direct `spawnSync('op', ['read', opRef])` inside `lib/providers/secret-resolver.mjs` instead of the pre-resolved `process.env` path above. This requires the `op` CLI to be reachable on the launching process's `PATH` and authenticated through one of two mechanisms: 1Password desktop-app CLI integration (Settings → Developer → Integrate with 1Password CLI, then unlock the app) or `OP_SERVICE_ACCOUNT_TOKEN` for non-interactive/headless contexts (a bare `op whoami` can still report "not signed in" under desktop-app integration — it checks account-level session state, while `op read` authenticates per call through the desktop app's IPC channel). Without either, `op read` throws `OP_NOT_SIGNED_IN`.
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
| `CONSTRUCT_HOOK_OUTPUT_MODE` | `auto` | SessionStart context routing: `auto` \| `silent` \| `stderr` \| `stdout`. `auto` keeps the rich payload on stdout for interactive sessions and suppresses it (to `~/.construct/session-start-last.log`) for non-interactive ones. Mirrors `hooks.outputMode` in `construct.config.json` (env wins). Set to `silent`/`stderr` from SDK / `claude -p` / automation callers so a one-shot command's stdout stays reserved for its own output. |
| `CONSTRUCT_NONINTERACTIVE` | : | Set truthy (`1`) by an SDK / automation caller to mark the invocation non-interactive, so `CONSTRUCT_HOOK_OUTPUT_MODE=auto` resolves to suppressed. Claude Code exposes no reliable in-hook interactive/print signal, so this flag (or `CI=true` / `NODE_ENV=test`) is how `auto` detects non-interactive mode. |

## Model router

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key: enables free model fallback when primary provider is down |
| `ANTHROPIC_API_KEY` | Anthropic key for Claude model calls |
| `OPENAI_API_KEY` | OpenAI key: used for OpenAI model tier or openai embedding model |
| `GITHUB_TOKEN` | GitHub PAT for integrations; may be a plain value or `op://` reference |
| `CONSTRUCT_OP_ENV_FILE` | Override path for the 1Password env file used by a local `op run` wrapper (default on this machine: `~/.config/claude/.env.op`) |
| `CONSTRUCT_MODEL_REASONING` | Override the reasoning-tier model id |
| `CONSTRUCT_MODEL_STANDARD` | Override the standard-tier model id |
| `CONSTRUCT_MODEL_FAST` | Override the fast-tier model id |
| `CONSTRUCT_MODEL_PROFILE` | Optional runtime profile. `small` enables tighter prompt budgets, compressed overlays, and retrieval-first prompt shaping for smaller local or cost-constrained models; `balanced` keeps the default posture. |
| `OLLAMA_BASE_URL` | Base URL for the Ollama HTTP API. `OLLAMA_HOST` remains accepted as a legacy alias. |

## Deprecations & Debug

| Variable | Description |
|---|---|
| `CONSTRUCT_DEPRECATIONS` | `error` to throw instead of warn on deprecated API usage (useful in CI) |
| `CONSTRUCT_DEV_PATH` | Absolute path to a Construct checkout; `.construct/launcher/run.mjs` resolves this first |
| `CONSTRUCT_AUTO_EMBED` | `1` to auto-start the embed daemon when provider credentials are present. `construct.config.json` `autoEmbed: true` is an equivalent project-committed fallback (env wins); read at runtime by `autoStartEmbedIfNeeded()` in `lib/embed/cli.mjs`. |
| `CONSTRUCT_WORKSPACE` | Override working directory for embed mode |
| `CONSTRUCT_TOOLKIT_DIR` | Override the path where Construct looks for its own toolkit (skills, agents, templates) |

## Bootstrap resource consent

Each optional resource stores operator consent in `config.env` (the XDG config dir) via a `BOOTSTRAP_<RESOURCE>` key (values: `yes`, `never`, blank = not yet asked).

| Key | Resource |
|---|---|
| `BOOTSTRAP_POSTGRES` | PostgreSQL + pgvector (Docker container) |
| `BOOTSTRAP_EMBEDDING_MODEL` | Local ONNX embedding model (~50 MB) |
