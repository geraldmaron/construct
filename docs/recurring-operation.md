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

## A window that moves with each firing

A workflow that declares a `period` input can be scheduled with a relative
period. Each firing works the period out at the time the firing was due, in
the trigger's timezone, so "every Monday, what changed last week" covers a
fresh week on every firing, and a tick the clock delivers late still covers
the week that was due. The run keeps that window in dates; the trigger keeps
the period as it was given.

A trigger's input is checked when it is defined: an undeclared key, a
malformed period, or a source id that names no declared source is refused
then, not at every firing. A schedule or event trigger also refuses a fixed
window for `changed_during` or `evidence_window` (from and to dates, a year,
or a quarter with its year), and dates given beside a relative period, since
each firing would repeat them; a fixed `as_of` date is allowed.

None of the shipped workflows that accept a schedule declares a period; a
project workflow can. This one is saved as
`.construct/workflows/weekly-digest/workflow.json`:

```json file=.construct/workflows/weekly-digest/workflow.json
{
  "format": "construct-workflow",
  "formatVersion": 1,
  "id": "weekly-digest",
  "title": "Weekly digest",
  "version": "1.0.0",
  "purpose": "Summarize what changed in the project over a period.",
  "activation": ["every Monday, what changed last week"],
  "standDown": ["a one-off question about the project"],
  "interactionClass": "maintain",
  "inputSchema": { "period": "period" },
  "requiredInputs": ["period"],
  "steps": [
    {
      "id": "summarize",
      "title": "Summarize what changed in the period",
      "capabilities": ["read_project_context"],
      "tier": "draft",
      "inputs": { "period": "input.period" },
      "outputs": ["summary", "findings"],
      "validators": ["deliverable_complete"],
      "loadBearing": true
    }
  ],
  "triggers": ["manual", "schedule"],
  "concurrency": "per_input",
  "deliverable": { "kind": "digest", "schema": "digest/v1" }
}
```

```bash
construct workflow schedule weekly-digest --cron="0 9 * * 1" --timezone=Europe/Berlin --input='period={"semantics":"changed_during","relative":"last_week"}' --trigger-id=weekly
construct workflow fire weekly --key=2026-10-12T09:00 --dry-run
construct workflow schedule weekly-digest --cron="0 9 * * 1" --input='period={"semantics":"changed_during","from":"2026-07-01","to":"2026-09-30"}'   # exits 1
```

The last line is refused: a fixed window on a standing trigger would cover
the same dates on every firing.
