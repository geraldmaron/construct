<!--
docs/operations/monitoring.md: Monitoring guide for Construct.

Covers structured JSON logs (lib/logger.mjs), CloudWatch metrics on AWS,
construct doctor checks, and circuit breaker states.
-->

# Monitoring

## Structured logs

Construct's non-interactive services (HTTP server, embed daemon) emit one JSON object per line to `stderr`. Each record includes:

| Field | Type | Description |
|---|---|---|
| `ts` | ISO string | Timestamp |
| `level` | string | `debug`, `info`, `warn`, `error` |
| `event` | string | Short stable identifier (e.g. `http.request`, `auth.fail`) |
| `req_id` | string | Correlation ID: ties a request's log lines together |
| `route` | string | Request path (HTTP server only) |
| `actor` | string | Token label or user identity when authenticated |
| `latency_ms` | number | Request duration (HTTP server only) |
| `detail` | object | Arbitrary subobject for extra context |

### Log level

Set `CONSTRUCT_LOG_LEVEL` to control verbosity:

```
CONSTRUCT_LOG_LEVEL=debug   # show all levels
CONSTRUCT_LOG_LEVEL=info    # default — info, warn, error only
CONSTRUCT_LOG_LEVEL=warn    # warn and error only
CONSTRUCT_LOG_LEVEL=error   # errors only
```

### Human-readable mode

Set `CONSTRUCT_LOG_PRETTY=1` for local development. Output switches from JSONL to a single-line human-readable format:

```
CONSTRUCT_LOG_PRETTY=1
```

Example output:
```
[2026-05-08T10:23:41.123Z] info  http.request {"route":"/api/status","latency_ms":4}
```

### Consuming logs

Pipe the service's stderr into any log aggregator that understands JSONL:

```bash
construct dev 2>&1 | tee /var/log/construct.log
```

For structured queries (e.g. finding all `auth.fail` events):

```bash
grep '"event":"auth.fail"' /var/log/construct.log | jq .
```

## CloudWatch metrics (AWS deploy)

When deployed to AWS via the Terraform templates in `deploy/terraform/`, logs flow to CloudWatch Logs automatically through the ECS task definition. The log group is named `construct-<environment>`.

Key metric filters to set up in CloudWatch:

| Metric | Filter pattern | Namespace |
|---|---|---|
| Error rate | `{ $.level = "error" }` | `Construct/<env>` |
| Auth failures | `{ $.event = "auth.fail" }` | `Construct/<env>` |
| Request latency | `{ $.latency_ms > 0 }` | `Construct/<env>` |

To query recent errors:

```bash
aws logs filter-log-events \
  --log-group-name construct-production \
  --filter-pattern '{ $.level = "error" }' \
  --start-time $(date -v-1H +%s000)
```

## Health check: `construct doctor`

Run at any time to verify the local install:

```bash
construct doctor
```

Checks performed:

- Node and npm versions meet minimums
- `~/.config/construct/config.env` exists and is parseable
- Required API keys are present (non-empty)
- Postgres reachable at `DATABASE_URL` (if configured)
- Claude Code hook script paths resolve correctly
- MCP server binary exists and is executable
- `construct sync` output matches current registry

Each check prints `ok` or a one-line error with a suggested fix.

## Circuit breaker states

Every provider method is wrapped with a circuit breaker that opens after 5 consecutive failures and holds closed for 30 seconds. States:

| State | Behavior |
|---|---|
| Closed | Normal: requests flow through |
| Open | Failing fast: requests reject immediately with a circuit-open error |
| Half-open | After cooldown: next request is a probe; success closes it, failure reopens |

Check provider health (which is not circuit-breaker-wrapped) to observe the current state:

```bash
construct provider test github
construct provider test atlassian-jira
```

If a provider is in `Open` state and the underlying service is back up, wait 30 seconds for the cooldown to expire. The next request automatically probes and closes the breaker.

## Audit trail

All mutations (file edits, bash commands, git operations) are recorded to `~/.construct/audit-trail.jsonl`. View the trail:

```bash
construct audit trail
construct audit trail --verify   # verify the tamper-evidence chain
construct audit trail --since 2026-05-01 --agent cx-engineer
```

The chain links each record to the SHA-256 of the previous line. Any deletion, reordering, or edit breaks the chain and is surfaced by `--verify`.
