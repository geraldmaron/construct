# Recurring and scheduled operation

[Documentation index](README.md) · [Project README](../README.md)

Construct owns what happens on a firing; the platform owns time. There is
no daemon. The one clock Construct writes is a per-user launchd agent or
systemd user timer, and only when you run `workflow install-timer` for a
trigger. Nothing else (init, install, any library call, the test suite)
writes or loads one.

## Defining a standing outcome

```bash
construct workflow schedule standing-review --cron="0 9 1 * *" --timezone=Europe/Berlin --max-tier=project_write --trigger-id=monthly
construct workflow triggers
construct workflow install-timer monthly --executor=codex
construct workflow recipe monthly --executor=codex
construct workflow recipe monthly --clock=github-actions --executor=codex
```

A trigger names the workflow, the schedule expression and timezone (or an
event name), the adapter that fires it (cron, CI, a host's own scheduler, or
manual), an overlap policy (skip, queue, replace), a permission boundary no
step may exceed, input, and delivery. `install-timer` installs the platform
timer that fires it; `recipe` prints the crontab line, the CI job, or (with
`--clock=launchd` or `--clock=systemd`) the exact unit `install-timer`
writes. Each needs an explicit executor. The generated recipe requires a persistent project state and an authenticated host. A fresh checkout contains neither the ignored trigger database nor a running agent.

From chat, the host reports a request to keep something up as a
`classify_request` reading of kind `maintain`, with its schedule: a
five-field cron expression and an IANA timezone, or an event name. When no
question blocks, `start_outcome` saves an idempotent trigger with the mapped
inputs and original intake, without starting an immediate run. The clock and
executor remain unprovisioned; the person must configure them before it can run
after the session exits. The CLI is an alternative definition and inspection path.

## A platform timer

```bash
construct workflow install-timer monthly --executor=codex
construct workflow timers
construct workflow remove-timer monthly
```

`install-timer` writes one unit per project and trigger, named
`construct.<project-id>.<trigger-id>`, into `~/Library/LaunchAgents` on macOS
or `~/.config/systemd/user` on Linux, and loads it with `launchctl bootstrap`
or `systemctl --user enable --now`. Installing again replaces the unit. The
unit starts `construct workflow fire <trigger> --execute=<executor>` in the
project's main checkout and exits; it is never kept alive.

- macOS fires on `StartCalendarInterval`, never `StartInterval`. launchd
  evaluates a calendar in the Mac's own timezone, so a trigger in another
  timezone is refused rather than shifted. A schedule needing more than 512
  calendar entries is refused too. A day and a weekday both restricted fire
  on either, as in cron.
- Linux fires on `OnCalendar` in the trigger's own timezone with
  `Persistent=true`, so a slot missed while the machine was off runs once on
  return.
- The unit carries only `PATH` (Node's directory, the executor's directory,
  and the system directories) and `CODEX_HOME` when you set it. No other
  variable from your shell, and no credential, goes into the unit. The
  executor uses its own login.
- Without `--executor`, the install is refused: a tick alone performs no
  model work.
- An install whose `HOME` or `XDG_CONFIG_HOME` is not this account's own is
  refused before anything is written, because the real scheduler would never
  read a unit written there.
- An install from a Construct that runs out of a linked git worktree is
  refused: the unit would stop working when that worktree is removed.
- A path the platform cannot hold exactly is refused rather than escaped
  into something else: a `$` in a command path, a working directory ending
  in a backslash or whitespace, or any control character.

`remove-timer` unloads the unit before it deletes anything. When the
scheduler cannot say whether the unit is gone, or still holds it after ten
seconds, the files stay and the command fails with the reason.

`workflow timers`, `status` and `doctor` list the installed units and whether
the scheduler will fire each one (loaded on macOS; active and enabled on
Linux). Another project's trigger state is marked unchecked, since its store
is not opened from here. Doctor
fails health for a unit whose project directory is gone or now holds another
project, and for one whose trigger was removed or disabled; `workflow
remove-timer <label>` removes a unit by the label doctor names, from any
directory.

When the executor's login has expired, the firing still records the slot
and leaves a blocked run whose reason names the problem, so a missed week
shows up in `status` and the inbox instead of passing silently. Logs from
launchd go to `timers/` under Construct's state directory.

## Firing

```bash
construct workflow fire monthly --key=2026-10-01T09:00 --dry-run
construct workflow fire monthly --key=2026-10-01T09:00  # exits 1
construct workflow fire monthly --key=2026-10-01T09:00
construct workflow disable monthly
construct workflow enable monthly
```

Every firing is recorded under the clock's key: the same key twice starts
one run and reports the second as deduplicated. A schedule trigger fired
without `--key`, as a platform timer or the cron line fires it, is keyed by
the schedule slot that was due, not the wall clock. A start that comes late,
or one start on wake standing for the slots missed while the machine slept,
covers the earliest slot that was due; a repeat after that slot was handled
names it again and is deduplicated.

A disabled trigger records each slot it passes over and moves past it, and
the firing exits 0. Turning the trigger back on owes none of the slots missed
while it was off: the next firing is the first slot after it was enabled. A
clock-supplied `--key` may not end in `~disabled`, which marks those records. A firing while a run is
still active follows the overlap policy and says so. Stale or missing data
follows the workflow's declared policy: a standing review blocks at start
when a source it reads is stale or unread, and a step that finds nothing
either succeeds empty, blocks with a question, or fails, as the workflow
declares. The person receives a finished no-drift record, a cited drift
report, or a concise blocked decision.

Without `--execute=codex`, these clock-only firings cannot provide model work; the first records a blocked run. `workflow executors` reports which unattended adapters are available. An explicit executor handoff remains bounded by its host sandbox and the run permissions.

The two `fire` lines above are the same key on purpose; the second reports
deduplicated. The `--dry-run` line resolves and starts nothing. A firing
whose run is blocked exits 1; every other outcome, a dry run included,
exits 0.

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

Shipped workflows with both schedule triggers and a period input include
`guided-outcome`, `decision-support` and `managed-outcome`.
See [the catalog](catalog.md) and inspect
`construct workflow show <id>` for a path's actual inputs and triggers;
a project workflow can declare a period too.
This one is saved as
`.construct/workflows/weekly-digest/workflow.json`:

```json file=.construct/workflows/weekly-digest/workflow.json
{
  "format": "construct-workflow",
  "formatVersion": 1,
  "id": "weekly-digest",
  "title": "Weekly digest",
  "version": "1.0.0",
  "purpose": "Summarize what changed in the project over a period.",
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


Repeating an identical standing definition does not duplicate it or re-enable
a disabled trigger. A saved standing intent is not a promise that work will run
after the session exits. Event triggers likewise need an authorized event sender.
