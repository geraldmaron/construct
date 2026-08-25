# Running Construct on a schedule

Construct has no scheduler of its own, and the designed state is nothing
running: the predecessor's daemon leak is the recorded lesson, so nothing waits
or wakes unless you asked for it by name. What Construct has is a **standing
outcome** — a recurring intention recorded in the store — and a CLI verb that
fires whatever has come due. The clock stays with whatever the machine already
trusts: `cron`, `launchd`, a CI job.

Residency is available and opt-in. If you want sub-interval sweeps without a
crontab, `construct daemon start` raises a resident process that fires the same
due work; it is described at the end of this page, and nothing raises it but
that verb.

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
construct daemon status  # is a resident running, and how long until it exits itself
construct doctor         # is the machine's install healthy
```

## The opt-in resident

A crontab wakes on its own cadence and cannot look sooner. When a watch earns
faster sweeps than that, one verb raises a resident process:

```bash
construct daemon start                     # the only thing that raises it
construct daemon status                    # version, uptime, idle seconds, what is due
construct daemon stop                      # asks it to stop, and waits until it has
construct daemon run --foreground          # the same loop, attached, logging to stderr
```

`start` accepts `--every=<seconds>` (how often it sweeps, default 60, jittered
by a tenth so a fleet does not sweep in lockstep) and `--idle-exit=<seconds>`
(the quiet period after which it exits itself, default 900, never below 60).
`run` is what `start` spawns and what a supervisor unit would exec; with
`--foreground` it stays attached, logs to stderr, and accepts a short quiet
period, which is what makes it usable for a look rather than a deployment.

What it does, and what it deliberately does not:

- **It sweeps source watches**, exactly as `construct watch --due` does. That
  costs a filesystem walk and a store write, and spends nothing on a model.
- **It re-files standing outcomes that have come due**, exactly as the filing
  half of `construct standing --due` does — and stops there. Working a filed
  run dispatches to a host, and a host needs a credential; nothing long-lived
  here holds one. Each filing is named in the log with the `construct work`
  line that would finish it, so the spending stays where a person is.
- **It exits itself when nothing is happening.** Every client connection and
  every sweep that found due work restarts the quiet period. A daemon nobody
  is using and nothing is asking of is a daemon that goes away.
- **It cannot be raised by anything else.** Not `init`, not install, not
  library code, not another verb. That is the leak this tool inherited, and the
  single door is checked by a test that reads the whole source tree.

Its identity is a unix socket at `<state dir>/daemon.sock`, keyed to the state
directory rather than the working directory, so a second checkout or worktree
finds the daemon that is already there instead of raising a second one. A
socket left behind by a killed daemon is not a live one: the next `start`
connects, gets refused, clears it, and binds. Its account of itself is one
timestamped file at `<state dir>/daemon.log`, rolled aside once when it passes
5MB. A newer Construct that reaches an older daemon is answered, and then that
daemon exits itself so the next `start` raises the current build.

## What not to schedule

A grounded run on a large repository against a small local model hits the
host's invocation ceiling and produces nothing (the recorded throughput floor
prints before the spend). Schedule cheap hosts for cheap ground, and give big
ground either a bounded workspace (`source add --workspace=…`, then
`outcome --workspace=…`) or a host that finishes.
