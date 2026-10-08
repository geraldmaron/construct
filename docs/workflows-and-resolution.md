# Workflows and dependency resolution

A workflow is a versioned manifest: typed inputs, ordered DAG steps with
stable ids and `needs`, per-step skill and version range, capability
requirements, source and freshness requirements, an action tier, input
mapping from the run input or upstream outputs, declared outputs,
validators, retry and timeout, triggers, no-data and stale-data policies,
concurrency and deduplication, cancellation, a deliverable contract, and
what the workflow may propose afterwards.

## Resolving before running

```bash
construct workflow list
construct workflow show design-conformance
construct workflow resolve design-conformance --input=target=src
construct workflow validate
```

Resolution fails before execution for a missing skill, workflow, capability,
or source; an incompatible version; a dependency cycle; a missing step
input; an output-to-input mismatch; an unknown action tier; a capability the
host does not provide; a step above the executor's tier; a load-bearing
output with no validator; a stale or unreachable mandatory source; an
ambiguous executor; or a diverged lock. Every result explains why the
workflow is runnable, blocked, outdated, or divergent, with a remedy per
reason. Nothing chooses a "close enough" skill, source, or version.

## Running

```bash
construct workflow run design-conformance --input=target=src --dry-run
construct workflow run design-conformance --input=target=src
construct run list
construct run show run-0001   # exits 1
```

A run is created once per idempotency key derived from the workflow's
dedupe fields. Its steps are leased to whoever executes them, the person's
session through the broker or a configured runner, with a fencing token; a
lost lease is reclaimed after expiry without repeating finished work. Every
step is gated through the policy engine; a step that needs an approval
raises one question scoped to exactly that action and the run waits. Every
submission runs the step's validators; a failure comes back with what to
fix and the step is retried by its policy. Steps that declare the kernel's
own drift capability are run by Construct itself.

The `run show` line above expects exit code 1 because no run with that id
exists in a fresh project; a real id comes from `workflow run --json`.

```bash
construct run cancel run-0001   # exits 1
construct run resume run-0001   # exits 1
```

## Typed inputs

Besides strings, numbers, booleans, string lists and objects, a workflow
input may be declared as one of two types Construct checks itself.

- `period`: the time the work covers. It is an object with `semantics` and
  exactly one way of naming the time. `semantics` is `as_of` (things as they
  stood at the end of a day), `changed_during` (what changed inside a
  window), or `evidence_window` (evidence dated inside a window). The time is
  `relative` (`this_week`, `last_week`, `this_month`, `last_month`,
  `this_quarter`, `last_quarter`, `this_year`, `last_year`, `year_to_date`,
  or `last_n_days` with `n` from 1 to 3660), a `quarter` from 1 to 4 with or
  without a `year`, a `year` alone, or `from` and `to` as YYYY-MM-DD. It may
  also carry a `timezone` and a `phrase`, the person's own words. Dates may
  accompany `relative`, `quarter` or `year` only when they agree with them.
- `source_ids`: a list of declared source ids. An id that names no active
  source blocks the run, with how to declare it.

A malformed period, or one given as prose such as "Q3", blocks the run with
the shape it takes; a period left out that the workflow requires names its
slot in the reason. How a period is worked out:

- Weeks run Monday to Sunday, and quarters are calendar quarters.
- `this_week`, `this_quarter` and the rest name the whole unit, and say so
  when it ends after today.
- `year_to_date` runs from January 1 to today, and `last_n_days` counts
  today.
- A quarter without a year is the most recent one that has started: asked on
  2026-08-15, Q4 is the fourth quarter of 2025.
- `as_of` keeps only the end date; an end after today is taken as of today.
- Dates are in the period's own timezone, else the caller's (a trigger's for
  a firing), else UTC.

Every result lists what it took as given, such as "quarters are calendar
quarters", "dates are in UTC", or "Q3 taken as 2026". The period is worked
out once, when the run is created, and frozen on the run: the run's input
keeps the period as it was given, every step that reads the period input
receives the dates, every step is told what the run covers and which sources
it names, and `run_status` shows both. Resuming, retrying, or answering a
decision never moves the window.

A period is part of the work's identity by what it means: its semantics,
dates, and timezone. `last_quarter` asked on two days of one quarter, or
`quarter` 3 with `year` 2026, is the same run; another window or another
semantics is different work. Source ids count as a set. A start that finds
the work under way says which inputs it gave differently, and a start whose
period was refused is replaced by the corrected one. A named source last
read on a day before a finished period ends is flagged at start so it can be
read again; the flag never blocks.

Evidence is checked against the period. A step that names `within_period`
refuses a cited item whose recorded update falls after the period ends,
under every semantics, unless the output lists it under `outsidePeriod` as
`{ref, why}` with why it belongs. An item last updated before the period
starts, an item with no date, and a project file are never refused. A step
that names `named_sources_read` needs something cited from each source the
run names (an item, a file, or a folder inside it; naming the whole source
does not count), or the source listed under `unread` as `{source, why}`.
The deliverable states the period it covers with its coverage: which
citations fall inside it, before it, or after it, which are undated
(project files count here, since they are read as they stand now), and the
`outsidePeriod` entries the run's steps gave for citations after it. It also states which named
sources something was cited from and which were listed as unread.
`check_answer` takes the same period for a plain answer.

A manifest declares at most one period input, since a run covers one
period, and a non-empty `dedupeKey` must include every `period` and
`source_ids` input, since work for a different period or sources is
different work. When a period input is declared, every step that checks
citations (`citations_present` or `evidence_refs_resolve`) must also name
`within_period`. [Recurring and scheduled operation](recurring-operation.md)
shows a trigger whose period moves with each firing.

## Deliverables and trust

A finished step leaves a draft. The final step's validators move it to
validated; a challenge, acceptance, and finality are recorded transitions
the person's judgment drives through the host. A task being done never
implies its deliverable is trusted.

The last step hands the deliverable back. Its body is what that step
returned plus every input the step was handed (from the run's input or
earlier steps), so the last step returns only what it adds. A handed value
wins over a restatement; a restated key whose value differs stays in the
step's own record, and `submit_work` names it under `ignored`. The body
also carries the last step's evidence, the sensitivity of what the run
cited (null when nothing cited carries a label), how many of the run's
citations Construct opened itself or holds only as the host's report
(`provenance`), and, when the run covers a period or names sources, its
coverage of both.

The general carrier, `managed-outcome`, runs plan, do, and verify for any
outcome no other workflow names. It takes the request, a target, a period,
and source ids. Its do step returns the summary, findings, the files it
changed, and `artifact` (the file it produced, or null), and is checked for
citations, the period, the named sources, grounded figures, and the files
it says it wrote. Its verify step runs the project's own checks and hands
the outcome back.

## Built-in workflows

Project bootstrap and constitution review, minimal remember, managed
outcome with verification, design-principle conformance review, source
freshness and drift review, adversarial deliverable review,
strategy-to-execution and capacity review, the standing review wrapper, and
one review per professional pack. See [catalog.md](catalog.md).
