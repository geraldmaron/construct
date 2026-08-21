# Running Construct on a schedule

Construct has no scheduler of its own, and that is a principle rather than a
gap: the predecessor's daemon leak is the recorded lesson, so nothing in this
tool waits, polls, or wakes. What it has is a **standing outcome** — a
recurring intention recorded in the store — and a CLI verb that fires whatever
has come due. The clock stays with whatever the machine already trusts:
`cron`, `launchd`, a CI job.

## Standing outcomes

Declare the intention once; it runs nothing until something fires it:

```bash
construct standing add --every=7d --workspace=ops \
  "Review the week's roadmap and tracker changes for commitments that no longer agree"
construct standing               # list them, with cadence and last firing
construct standing retire <id>   # stop it; its firings stay on the record
```

Then schedule the one firing line:

```bash
construct standing --due --host=claude --ceiling=5
```

Each elapsed intention is re-filed as a fresh, ordinary run — same plan, same
work log, same inbox as an outcome typed that morning — then worked through
the normal `work` path with whatever host flags the firing line carries, so
every execution keeps full run lineage and `construct standing` can show when
each intention last fired. A `--due` that finds nothing elapsed files nothing
and says so — but it still resumes any earlier standing-filed run left with
unfinished tasks, so a firing killed mid-flight is picked up by the next
`--due` rather than waiting out another cadence. Declaring with `--domains=<name,…>` names the staff outright, so
an unattended firing spends nothing on inference; the names are checked
against the catalog at declaration, where a typo costs one retype instead of
every firing until somebody reads the log.

## The bare recipe

The composed form still works and is still honest — a standing outcome is
exactly this pair, remembered by the store instead of a crontab:

```bash
construct outcome --host=claude --workspace=ops \
  "Review the week's roadmap and tracker changes for commitments that no longer agree" \
&& construct work --ceiling=5
```

Either way, the pieces behave the way a scheduled task needs:

- **`work` is resumable.** A run killed mid-flight leaves leased tasks that a
  later invocation reclaims after the lease expires; nothing is duplicated and
  nothing is lost. A second scheduled firing while the first still runs is
  safe for the same reason.
- **The ceiling is total, not per-run.** `--ceiling` bounds spend across every
  run the store has recorded, so a runaway schedule cannot spend nightly what
  you approved once. Raise it deliberately when it halts.
- **Decisions do not block.** A conflict between roles, or a deliverable with
  unfilled required sections, becomes an inbox decision carrying the default
  the work proceeds on. The schedule keeps running; the human reads
  `construct inbox` on their own clock.
- **Everything is auditable after the fact.** `construct log --run <id>` says
  what was done in whose name; the work log is append-only, enforced by the
  store, not by discipline.

## Watching an external source

A standing outcome re-files an intention through a host; a **source watch**
does not spend anything by default. It points at a source you have already
declared (`construct source add`) and, on its own cadence, compares what is
there now against what its last firing recorded. Nothing is interpreted — no
host is consulted unless the declaration names one — so the comparison is
exactly the structural fact a filesystem walk can state: which documents
exist, how large they are, and whether the source can be reached at all.

```bash
construct source add --kind=directory --locator=/path/to/docs-repo --workspace=ops
construct watch add --source=<source-id> --every=1d
construct watch list             # every declared watch, with cadence and last firing
construct watch retire <id>      # stop it; its firings stay on the record
```

Then schedule the one firing line, exactly as a standing outcome's:

```bash
construct watch --due
```

Each due watch surveys its source, compares the survey to the snapshot its
last firing recorded, and raises whatever changed as one decision in
`construct inbox` — it never resolves anything, never edits the source, and
never spends on a model: naming `--host=<opencode|claude|codex|cursor>` at
declaration only records intent for whatever reviews the finding next. A
firing is recorded whether or not anything changed, so a watch whose ground
has not moved fires quietly — the firing lands on the work log
(`construct log --run watch-<id>`), but no decision follows it. A newly
declared watch's first sweep is quiet the same way: there is no prior
snapshot yet to compare against, only one being recorded for the next sweep
to use.

## Checking on it

```bash
construct standing       # what stands, and when each last fired
construct watch list     # every declared source watch, and when each last fired
construct inbox          # what needs a human
construct log | tail     # what happened last
construct doctor         # is the machine's install healthy
```

## What not to schedule

A grounded run on a large repository against a small local model hits the
host's invocation ceiling and produces nothing (the recorded throughput floor
prints before the spend). Schedule cheap hosts for cheap ground, and give big
ground either a bounded workspace (`source add --workspace=…`, then
`outcome --workspace=…`) or a host that finishes.
