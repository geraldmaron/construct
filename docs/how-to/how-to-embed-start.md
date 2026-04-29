# How to Start Embed Mode

Embed mode runs a background daemon that continuously polls your connected providers, builds snapshots, generates a roadmap, and writes observations into your knowledge base.

## Before you start

You need at least one provider configured in `~/.construct/config.env`. Jira and GitHub are the most common starting points.

Check what is currently configured:

```sh
construct embed status
```

If the output shows `stopped`, you are ready to start.

## Start the daemon

```sh
construct embed start
```

This spawns a detached background process. Logs are written to stderr and the process continues after you close the terminal.

The daemon runs nine scheduled jobs:

| Job | What it does | Interval |
|-----|-------------|----------|
| snapshot | Polls all providers, writes `.cx/snapshot.md` | Per config (default: 5 min) |
| provider-health | Logs degraded providers, writes observations | 5 min |
| session-distill | Extracts session summaries into the observation store | 10 min |
| self-repair | Removes stale locks, heals broken state files | 15 min |
| approval-expiry | Expires stale approval queue items | 1 hour |
| eval-dataset-sync | Syncs scored Langfuse traces to Dataset items | 1 hour |
| prompt-regression-check | Detects low-quality score clusters per prompt | 1 hour |
| inbox-watcher | Ingests new files from `.cx/inbox/` | 2 min |
| roadmap | Generates `.cx/roadmap.md` from open items + observations | 1 hour |

## Check that it is running

```sh
construct embed status
```

Expected output includes `running`, the daemon PID, and pending approval count.

## Stop the daemon

```sh
construct embed stop
```

## View the latest snapshot

```sh
cat ~/.cx/snapshot.md
```

Or open the dashboard:

```sh
construct serve
```

Then go to `http://localhost:3000` and open the **Snapshot** tab.

## Change the storage root

By default all data is stored under `~/.cx/`. To use a different location (useful for Docker volumes):

```sh
export CX_DATA_DIR=/mnt/construct-data
construct embed start
```

See [how-to-cx-data-dir.md](how-to-cx-data-dir.md) for details.
