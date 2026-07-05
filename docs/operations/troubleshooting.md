<!--
docs/operations/troubleshooting.md: Common errors and resolutions for Construct.

Covers hook not firing, embedding model missing, Postgres not found,
provider auth failures, dashboard unreachable, and bd list hangs.
-->

# Troubleshooting

## Hook not firing

**Symptoms:** Session-start context is not injected; no stop summary appears; no audit trail entries.

**Checks:**

1. Confirm hooks are configured in `.claude/settings.json`:

   ```bash
   cat ~/.claude/settings.json | grep -A5 hooks
   ```

   You should see entries for `PreToolUse`, `PostToolUse`, and `Stop`.

2. Re-run sync to regenerate settings:

   ```bash
   construct sync
   ```

3. Confirm the hook script path resolves:

   ```bash
   node ~/.npm-global/lib/node_modules/@geraldmaron/construct/lib/hooks/session-start.mjs < /dev/null
   ```

   If this errors, the global install path is wrong. Reinstall with `npm install -g @geraldmaron/construct`.

4. Check for a syntax error in a hook file (relevant only if you have edited hook files):

   ```bash
   node --check lib/hooks/session-start.mjs
   ```

## Embedding model missing or embedding fails

**Symptoms:** `construct storage sync` errors with "embedding model not available"; semantic search returns no results.

**Checks:**

1. Confirm `ANTHROPIC_API_KEY` is set:

   ```bash
   grep ANTHROPIC_API_KEY ~/.config/construct/config.env
   ```

2. Confirm the key is valid (non-expired, correct prefix `sk-ant-`):

   ```bash
   construct doctor
   ```

3. If using an alternative embedding provider, confirm `OPENAI_API_KEY` or `OPENROUTER_API_KEY` is set and the model tier is configured:

   ```bash
   construct models
   ```

4. For local embed mode, confirm the embed daemon is running:

   ```bash
   construct embed status
   ```

   Start it if stopped: `construct embed start`.

## Postgres not found

**Symptoms:** `construct doctor` reports Postgres check failed; `DATABASE_URL` errors on any command that reads from memory or storage.

**Checks:**

1. Confirm Docker is running (for the managed Postgres container):

   ```bash
   docker ps | grep construct-postgres
   ```

   If the container is not listed, start the managed services: `construct dev`.

2. Confirm `DATABASE_URL` is set in `~/.config/construct/config.env`:

   ```bash
   grep DATABASE_URL ~/.config/construct/config.env
   ```

   If missing, run `construct init` to configure it.

3. Test the connection directly:

   ```bash
   psql "$DATABASE_URL" -c "SELECT 1;"
   ```

   If this fails, the credentials or host in `DATABASE_URL` are wrong.

4. If using an external Postgres, confirm `pgvector` extension is installed:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

## Schema migration drift

**Symptom:** `construct doctor` shows `Schema migrations: N drifted` ⚠, or any storage sync errors out with `Migration drift detected (a previously-applied migration file has changed)`.

**Cause:** A long-lived developer database has stale SHAs recorded in `construct_schema_migrations` for files that have since evolved. Fresh installs are not affected. Common after a Construct upgrade that ships an evolved earlier migration.

**Resolution:**

```bash
# Inspect first — read-only, lists which files drifted and whether each is idempotent
construct storage migrations

# Heal idempotent drift (re-applies the file via CREATE … IF NOT EXISTS clauses, updates the recorded SHA)
construct storage repair-migrations --yes
```

The repair refuses any file containing `DROP`, `TRUNCATE`, `ALTER … DROP`, or `DELETE`. If `construct storage migrations` reports drift on a non-idempotent file, the only safe path is to write a new migration file with a higher sequence number: never silently re-record the SHA.

## Provider auth failure

**Symptoms:** `construct provider test <id>` returns `ok: false`; agent tools return "not authorized" or HTTP 401/403 errors.

**Resolution by provider:**

- **GitHub**: Confirm `GITHUB_TOKEN` is set and not expired. Tokens expire if set with an expiry date. Generate a new one at [github.com/settings/tokens](https://github.com/settings/tokens).
- **Jira / Confluence**: API tokens do not expire but can be revoked. Regenerate at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Confirm `JIRA_BASE_URL` uses the exact Atlassian Cloud subdomain.
- **Slack**: Bot tokens are revoked when the app is uninstalled or the token is reset in the Slack admin. Reinstall the app or generate a new token.
- **Salesforce**: Access tokens expire (typically 2 hours for Connected App tokens). Refresh using SFDX: `sf org login web -a myorg` and update `SALESFORCE_ACCESS_TOKEN`.

After updating credentials:

```bash
# Update config.env
nano ~/.config/construct/config.env

# Verify
construct provider test <id>
```

## Dashboard unreachable

**Symptoms:** the dashboard URL in `construct status` shows "connection refused" or "page not found".

**Checks:**

1. Confirm the dashboard is running:

   ```bash
   construct status --json | jq .dashboard
   ```

2. Check the configured dashboard URL and port:

   ```bash
   construct status
   ```

3. If running inside a devcontainer or remote SSH, confirm port forwarding is active. The default port is 4242.

4. If you have a `DASHBOARD_PORT` override in `config.env`, confirm it is not already in use:

   ```bash
   lsof -i :4242
   ```

5. Restart the managed services:

   ```bash
   construct stop && construct dev
   ```

## `construct sync` fails with registry errors

**Symptoms:** `construct sync` exits non-zero; errors reference `specialists/org`.

**Check:**

```bash
construct validate
```

This validates `specialists/org` and prints specific field constraint violations. Fix the errors, then re-run `construct sync`.

## Memory search returns nothing

**Symptoms:** `memory_search` and `memory_recent` MCP tools return empty results even after multiple sessions.

**Checks:**

1. Confirm memory injection is not disabled:

   ```bash
   grep CONSTRUCT_MEMORY ~/.config/construct/config.env
   ```

   Remove or set to `on` if it was set to `off`.

2. Confirm observations are being recorded. After a session, check:

   ```bash
   construct memory stats
   ```

3. Cold start is expected: the first 5 sessions have sparse observations. Run `construct bootstrap` to import a seed corpus that provides baseline recall immediately.

4. If stats show observations exist but search returns nothing, rebuild the index:

   ```bash
   construct storage sync
   ```

## `bd list` hangs or never terminates

**Symptoms:** bare `bd list` (the default tree view) never returns; CPU and memory climb without bound; killing the runaway process can leave the next `bd` command stuck on `waiting for lock on .../.beads/embeddeddolt`.

**Cause:** this is a bug in the `bd` binary itself (`~/.local/bin/bd`, built from the external open-source project [steveyegge/beads](https://github.com/steveyegge/beads) — not part of this repo, cannot be patched here). The default tree renderer walks `relates-to` edges (created via `bd dep relate`) as if they were parent-child hierarchy edges, with no visited-set. Any *bidirectional* `relates-to` link between two issues (e.g. `relate A B` and `relate B A`) makes the renderer recurse forever. Confirmed by direct reproduction: bare `bd list` against this repo's issue graph produced tens of gigabytes of output within ~10 seconds before being killed. `bd dep cycles` correctly reports no cycle in this situation — relates-to is not a blocking dependency edge, and the cycle checker only walks `blocks`/`conditional-blocks` edges, so it never sees the problem.

**Safe alternatives (all confirmed to terminate normally):**

```bash
bd list --flat     # flat listing, no recursive tree walk
bd list --json      # JSON output, same non-recursive path
bd ready             # ready-work view, unaffected
```

Default to one of these instead of bare `bd list` until an upstream `bd` release adds a visited-set to the tree walker. Construct's own internal automation (`lib/beads-automation.mjs`, `lib/doctor/watchers/bd-watch.mjs`, `lib/hooks/policy-engine.mjs`) already calls `bd list` only with `--json` and is not affected — the exposure is limited to interactive terminal use of the bare command.

**Prevention:** avoid adding a *bidirectional* `bd dep relate` link between two issues. A one-directional related link, or a plain-text cross-reference in a comment, carries the same context without triggering the recursion.

**Remediation status:** no fix lives in this repo — `bd` is a separately compiled, externally sourced binary. The correct fix belongs upstream at [github.com/steveyegge/beads](https://github.com/steveyegge/beads) (file an issue against the tree-walker in the `list` command). See bead `construct-qqv9` for reproduction evidence and status.
