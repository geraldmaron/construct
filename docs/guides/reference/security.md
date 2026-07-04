<!--
docs/security.md: Security guide for Construct.

Covers credential handling, audit log, CSRF, CORS, rate limiting,
token rotation, and CONSTRUCT_DEPRECATIONS=error mode.
-->

# Security

To report a vulnerability, see [SECURITY.md](../SECURITY.md) (private reporting, response targets, and the consumer interim-mitigation guidance). This guide covers operational hardening.

## Credential handling

All secrets (API keys, database passwords, tokens) are stored in `~/.config/construct/config.env`. This file lives outside any project repository and is never committed to git.

**Rules:**

- Do not set secrets in shell profiles (`~/.bashrc`, `~/.zshrc`) that get sourced by all processes: they become visible to all programs on the machine.
- Do not set secrets in project `.env` files that are tracked by git. Use `.gitignore` to exclude `.env` if you use one.
- `config.env` is owned by your user with mode `600`. The setup wizard sets this automatically; verify with `ls -la ~/.config/construct/config.env`.

### Secret scanning

The `scan-secrets` hook runs after every `Edit` and `Write` tool use and blocks (exits 2) if a file contains patterns matching known API keys or credentials. Patterns include:

- Anthropic API keys (`sk-ant-...`)
- OpenAI keys (`sk-...`, `sk-proj-...`)
- OpenRouter keys (`sk-or-v1-...`)
- AWS access keys (`AKIA...`)
- GitHub personal access tokens (`ghp_...`)
- PEM private keys
- Database URLs with embedded credentials

If `scan-secrets` blocks a write, check whether you are embedding a real credential. Replace it with a placeholder or reference the key via `process.env.KEY_NAME` instead.

### Secrets in backups

`construct backup create` does not include `config.env` by default. Add `--include-secrets` only if you are storing the backup in an encrypted location.

## Audit trail

Every mutation (file edit, write, mutating bash command, git operation) is appended to `~/.cx/audit-trail.jsonl`. Each record includes:

| Field | Description |
|---|---|
| `ts` | ISO timestamp |
| `tool` | Tool that made the change (`Edit`, `Write`, `Bash`, etc.) |
| `agent` | Agent name at the time of the mutation |
| `target` | File path or bash command |
| `content_hash` | SHA-256 prefix of the file after the change |
| `prev_line_hash` | SHA-256 of the previous JSONL line (tamper-evidence chain) |

The chain means any after-the-fact deletion, reordering, or editing of the log is detectable:

```bash
construct audit trail --verify
```

Exits 0 if the chain is intact, exits 1 and lists broken links if not.

View recent entries:

```bash
construct audit trail
construct audit trail --agent cx-engineer --since 2026-05-01
construct audit trail --json | jq 'select(.tool == "Bash")'
```

## Dashboard security

### Authentication

The dashboard requires a bearer token on all API requests. `construct install` and `construct init` create the local config file when needed. Confirm the active dashboard URL and credential state with:

```bash
construct status --json
```

The token is stored in `CONSTRUCT_DASHBOARD_TOKEN` in `~/.config/construct/config.env`. Rotate it by updating that value, restarting services with `construct stop` then `construct dev`, and updating any clients that use the old token.

### CSRF protection

The dashboard server validates the `Origin` header on state-mutating requests (POST, PATCH, DELETE). Requests from origins not in the CORS allowlist are rejected.

### CORS allowlist

By default only `localhost` origins are allowed. For deployed instances, set:

```
DASHBOARD_CORS_ORIGINS=https://dashboard.your-domain.com
```

Multiple origins: comma-separated.

### Rate limiting

The dashboard server enforces a per-IP request rate limit. The default is 100 requests per minute. Override with:

```
DASHBOARD_RATE_LIMIT=200
```

## Network egress guard (SSRF / DNS-rebinding)

Every outbound HTTP call Construct makes on behalf of a manifest, provider, or url-type MCP entry runs through the shared egress guard in `lib/net-guard.mjs` (LMCP-N7). The destination of these calls is attacker-influenceable — a malicious manifest URL or a rebinding DNS record can aim an otherwise-trusted request at a loopback or private-range service and pivot into the host.

The guard enforces two properties together:

- **Address policy** — the destination hostname is resolved and *every* returned address is classified. Loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local (`169.254.0.0/16` — including the `169.254.169.254` cloud-metadata address), CGNAT (`100.64/10`), and unspecified/reserved ranges are **denied by default** with a named reason. Non-`http(s)` schemes are rejected.
- **Rebinding pinning** — the address validated at check time is the exact address the socket connects to. The hostname resolves once; the connection dials the pinned IP with the original hostname preserved as TLS servername + `Host` header, so a DNS record that flips to a private address between check and connect cannot move the connection.

Private-range egress is an explicit, audited opt-in for self-hosted instances, never the default: set `CONSTRUCT_NET_ALLOW_PRIVATE_EGRESS=1` (or a provider config's `allowPrivateEgress: true`). The governed-write provider transports (Jira, Confluence) route through `guardedFetch`; the inbound HTTP MCP transport applies the complementary Host/Origin allowlist and RFC 8707 bearer-audience checks (see the transport separation in `lib/mcp/transport/`).

## Deprecation enforcement

Construct exposes a `CONSTRUCT_DEPRECATIONS` mode for catching uses of deprecated APIs before they break:

```bash
CONSTRUCT_DEPRECATIONS=error construct <command>
```

In `error` mode, any call to a deprecated code path throws instead of warning. Use this in CI to catch deprecated usage before it reaches production.

## Hook security

Hooks run as shell commands before and after every tool use. The following hooks enforce security invariants:

| Hook | What it enforces |
|---|---|
| `guard-bash` | Blocks destructive shell commands (rm -rf /, force push to main, fork bombs, DROP TABLE) |
| `scan-secrets` | Blocks writes that contain real credentials |
| `edit-guard` | Confirms `old_string` exists in the target file before allowing edits (prevents mismatched writes) |
| `config-protection` | Blocks edits to protected configuration files without an explicit override |
| `pre-push-gate` | Validates branch, tests, and documentation completeness before `git push` |

Hook scripts in `lib/hooks/*.mjs` are protected files. Do not edit them without testing in isolation: a broken hook blocks all tool use in the session.

## Principle of least privilege

When configuring provider credentials, use the minimum required scopes:

- **GitHub**: `repo:read` for private repos; `public_repo` for public-only. No write scopes unless the provider implements `write`.
- **Jira/Confluence**: API tokens inherit the account's permissions. Use a service account with read-only project access.
- **Slack**: Bot scopes `channels:history channels:read`. Add `groups:history` only if private channel access is needed.
- **Salesforce**: Read-only Connected App profile unless write capability is needed.
