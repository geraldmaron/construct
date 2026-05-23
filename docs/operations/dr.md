<!--
docs/operations/dr.md: Disaster recovery runbook for Construct.

Fresh-machine recovery: install, restore backup, re-sync platform adapters,
and verify health.
-->

# Disaster Recovery

This runbook covers full recovery of a Construct install on a fresh machine. Expected time: 15–30 minutes depending on database size and network speed.

## Prerequisites

- Node.js 20+ and npm 9+
- Docker Desktop (for managed Postgres) or an existing Postgres 15+ instance with `pgvector`
- Access to your most recent Construct backup archive
- Your `~/.construct/config.env` (or the backup that includes secrets)

## Step 1: Install Construct

```bash
npm install -g @geraldmaron/construct
construct version   # confirm install succeeded
```

## Step 2: Restore config

If your backup includes secrets (created with `--include-secrets`), skip to Step 3. Otherwise, recreate `~/.construct/config.env` manually:

```bash
construct init --yes
```

The wizard prompts for all required API keys. If you have the original `config.env`, copy it to `~/.construct/config.env` instead of running the wizard.

## Step 3: Restore from backup

Copy your backup archive to the new machine, then restore:

```bash
construct backup restore /path/to/construct-2026-05-08T10-30-00Z.tar.gz --confirm
```

If the backup does not include secrets, edit `~/.construct/config.env` after restore to add the correct credentials.

## Step 4: Verify Postgres

```bash
construct doctor
```

Look for the Postgres check. If it fails:

- Confirm Docker is running (for managed Postgres): `docker ps`
- Confirm `DATABASE_URL` is set correctly in `~/.construct/config.env`
- Start the managed database if it is not running: `construct up`

## Step 5: Re-sync platform adapters

Regenerate the Claude Code settings, MCP server config, and any other platform adapter files:

```bash
construct sync
```

This rewrites platform config files from the current `agents/registry.json` and Construct install.

## Step 6: Re-index knowledge

Document embeddings and the local vector index are not included in the backup. Re-index after restore:

```bash
construct storage sync
```

For large knowledge bases this can take several minutes.

## Step 7: Verify full health

```bash
construct doctor
construct status
```

Both should show all checks passing. If anything is still failing, consult [docs/operations/troubleshooting.md](troubleshooting.md) for specific error codes and fixes.

## Step 8: Verify agent access

Open Claude Code and confirm the session-start hook fires and injects context. Run one agent command to confirm MCP tools are responsive:

```
memory_recent
```

If the tool returns results from before the backup date, the memory store restored correctly.

## Recovery time objectives

| Component | Recovery time |
|---|---|
| Install + config | ~5 minutes |
| Backup restore (small DB, <100 MB) | ~5 minutes |
| Backup restore (large DB, >1 GB) | ~20 minutes |
| Knowledge re-index (varies by doc count) | 5–30 minutes |
| Total estimated RTO | 15–60 minutes |

## Notes

- The backup does not include telemetry trace data. Historical performance reviews are not recoverable unless you have a separate telemetry backup.
- SSH keys, GitHub tokens, and other secrets in `config.env` should be stored in a separate secrets manager. Losing them means rotating them, not recovering them from backup.
- If the original machine is still accessible, compare `~/.cx/audit-trail.jsonl` checksums to confirm no data was lost between the last backup and the failure.
