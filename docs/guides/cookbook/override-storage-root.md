---
title: Override storage root
description: Point Construct at a custom state location for sandboxing or multi-profile setups.
---

By default, Construct stores all persistent data under `~/.construct/`. This includes snapshots, observations, sessions, the knowledge base, roadmap, and approval queue.

You can override this root with the `CX_DATA_DIR` environment variable.

## When to use this

- Docker deployments: mount a named volume and point `CX_DATA_DIR` at it so data persists across container restarts.
- Multi-project isolation: run separate Construct instances with separate data roots.
- Custom backup paths: store `.construct/` on a drive you back up separately.

## How to set it

```sh
# In ~/.config/construct/config.env
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
| `$CONSTRUCT_DATA_DIR/.construct/knowledge/` | Knowledge base (internal, external, decisions, how-tos, reference) |
| `$CX_DATA_DIR/inbox/` | Inbox watcher drop zone |
| `$CONSTRUCT_DATA_DIR/.construct/snapshot.md` | Latest rendered snapshot |
| `$CONSTRUCT_DATA_DIR/.construct/roadmap.md` | Latest generated roadmap |
| `$CONSTRUCT_DATA_DIR/.construct/observations.jsonl` | Observation store |
| `$CONSTRUCT_DATA_DIR/.construct/sessions/` | Session store |
| `$CONSTRUCT_DATA_DIR/.construct/runtime/` | Daemon state and PID files |
| `$CONSTRUCT_DATA_DIR/.construct/sync.lock` | Sync lock file |
| `$CONSTRUCT_DATA_DIR/.construct/approval-queue.jsonl` | Pending approval items |

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

- `config.env` is always loaded from `~/.config/construct/config.env`, regardless of `CX_DATA_DIR`.
- The `CX_DATA_DIR` value must be an absolute path.
- If the directory does not exist, Construct creates it on first run.
