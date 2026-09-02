# Recurring and scheduled operation

Construct owns what happens on a firing; an external clock owns time. There
is no daemon.

## Defining a standing outcome

```bash
construct workflow schedule standing-review --cron="0 9 1 * *" --timezone=Europe/Berlin --max-tier=project_write --trigger-id=monthly
construct workflow triggers
construct workflow recipe monthly
construct workflow recipe monthly --clock=github-actions
```

A trigger names the workflow, the schedule expression and timezone (or an
event name), the adapter that fires it (cron, CI, a host's own scheduler, or
manual), an overlap policy (skip, queue, replace), a permission boundary no
step may exceed, input, and delivery. `recipe` prints the crontab line or
the CI job that fires it.

## Firing

```bash
construct workflow fire monthly --key=2026-10-01T09:00 --dry-run
construct workflow fire monthly --key=2026-10-01T09:00
construct workflow fire monthly --key=2026-10-01T09:00
construct workflow disable monthly
construct workflow enable monthly
```

Every firing is recorded under the clock's key: the same key twice starts
one run and reports the second as deduplicated. A firing while a run is
still active follows the overlap policy and says so. Stale or missing data
follows the workflow's declared policy: a standing review blocks at start
when a source it reads is stale or unread, and a step that finds nothing
either succeeds empty, blocks with a question, or fails, as the workflow
declares. The person receives a finished no-drift record, a cited drift
report, or a concise blocked decision.

The two `fire` lines above are the same key on purpose; the second reports
deduplicated. The `--dry-run` line resolves and starts nothing.
