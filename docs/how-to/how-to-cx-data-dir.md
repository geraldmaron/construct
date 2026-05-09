# How to Override the Storage Root (CX_DATA_DIR)

By default, Construct stores all persistent data under `~/.cx/`. This includes snapshots, observations, sessions, the knowledge base, roadmap, and approval queue.

You can override this root with the `CX_DATA_DIR` environment variable.

## When to use this

- Docker deployments: mount a named volume and point `CX_DATA_DIR` at it so data persists across container restarts.
- Multi-project isolation: run separate Construct instances with separate data roots.
- Custom backup paths: store `.cx/` on a drive you back up separately.

## How to set it

```sh
# In ~/.construct/config.env
CX_DATA_DIR=/mnt/construct-data
```

Or inline for one-off use:

```sh
CX_DATA_DIR=/tmp/test-run construct embed start
```

## What moves

All storage paths are derived from `CX_DATA_DIR`:

| Path | Purpose |
|------|---------|
| `$CX_DATA_DIR/.cx/knowledge/` | Knowledge base (internal, external, decisions, how-tos, reference) |
| `$CX_DATA_DIR/.cx/inbox/` | Inbox watcher drop zone |
| `$CX_DATA_DIR/.cx/snapshot.md` | Latest rendered snapshot |
| `$CX_DATA_DIR/.cx/roadmap.md` | Latest generated roadmap |
| `$CX_DATA_DIR/.cx/observations.jsonl` | Observation store |
| `$CX_DATA_DIR/.cx/sessions/` | Session store |
| `$CX_DATA_DIR/.cx/runtime/` | Daemon state and PID files |
| `$CX_DATA_DIR/.cx/sync.lock` | Sync lock file |
| `$CX_DATA_DIR/.cx/approval-queue.jsonl` | Pending approval items |

## Docker example

```yaml
services:
  construct:
    image: construct:latest
    environment:
      - CX_DATA_DIR=/data
    volumes:
      - construct-data:/data

volumes:
  construct-data:
```

## Notes

- `config.env` is always loaded from `~/.construct/config.env`, regardless of `CX_DATA_DIR`.
- The `CX_DATA_DIR` value must be an absolute path.
- If the directory does not exist, Construct creates it on first run.
