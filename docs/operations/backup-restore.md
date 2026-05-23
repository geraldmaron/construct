<!--
docs/operations/backup-restore.md: Backup and restore guide for Construct.

Covers construct backup create/verify/restore, what gets backed up, and
how to schedule regular backups.
-->

# Backup and Restore

Construct stores its durable state in Postgres (observations, sessions, document index) and in local files (`~/.cx/`, `~/.construct/`). Regular backups protect against data loss and enable machine-to-machine migration.

## Create a backup

```bash
construct backup create
```

Creates a snapshot in `~/.construct/backups/postgres/` containing:

- Postgres dump (all observations, sessions, entities, document embeddings)
- Session index (`~/.cx/sessions/`)
- Audit trail (`~/.cx/audit-trail.jsonl`)
- Registry snapshot from the current Construct install

### Include secrets

By default, `config.env` is not included in the backup. Add `--include-secrets` to include it:

```bash
construct backup create --include-secrets
```

Backup files are stored unencrypted. Keep them in a secure location: treat them with the same care as `config.env`.

### Backup file naming

Backups are named by timestamp:

```
~/.construct/backups/postgres/construct-2026-05-08T10-30-00Z.tar.gz
```

## Verify a backup

```bash
construct backup verify
```

Reads the most recent backup and confirms:

- Archive is not corrupt (checksum valid)
- Postgres dump is parseable
- Key tables are present

To verify a specific archive:

```bash
construct backup verify ~/.construct/backups/postgres/construct-2026-05-08T10-30-00Z.tar.gz
```

## Restore from a backup

```bash
construct backup restore
```

Restores from the most recent backup. The command requires `--confirm` to prevent accidental overwrites:

```bash
construct backup restore --confirm
```

To restore from a specific archive:

```bash
construct backup restore ~/.construct/backups/postgres/construct-2026-05-08T10-30-00Z.tar.gz --confirm
```

Restore steps performed:

1. Stop Construct services (`construct down`)
2. Drop and recreate the Postgres schema
3. Load the Postgres dump
4. Restore session index files
5. Restore audit trail
6. Start services (`construct up`)
7. Run `construct doctor` to verify health

## Purge old backups

```bash
construct backup purge
```

Removes backups older than 30 days. Use `--confirm` to execute:

```bash
construct backup purge --confirm
```

## Schedule regular backups

Add a cron job to run backups automatically. Example (daily at 02:00):

```cron
0 2 * * * /usr/local/bin/construct backup create >> ~/.construct/backups/backup.log 2>&1
```

Verify the cron is working by checking the log file and the backup timestamps.

## What is not backed up

- `~/.cx/knowledge/`: indexed documents. Re-index with `construct storage sync` after restore.
- `~/.cx/skills-profile.json`: skill scope cache. Regenerates automatically on next `construct skills scope`.
- Platform adapter files (e.g. Claude Code settings): regenerate with `construct sync`.
