# Running Construct on a schedule

The kernel contains no scheduler: every tier below fires the same
`construct standing --due` and `construct watch --due` verbs, and all
scheduling state — cadences, last-firing times, what elapsed — stays in the
store, not in a resident process. The invariant is not "no daemon exists"; it
is narrower and stays true at every tier: **nothing resident runs that no
explicit user verb asked for.** Unasked residency stays dead. Asked-for
residency is a ladder, and you pick the rung.

## The ladder

**Tier 1, the default: `construct schedule install`.** One verb writes a
platform timer — a launchd `LaunchAgent` on macOS, a systemd user timer on
Linux — that fires `construct standing --due && construct watch --due` on a
cadence you name. The process exists only for the length of one firing; there
is nothing to start, crash, or leak between firings, and the platform's own
calendar form catches up missed firings after sleep instead of dropping them.

**Tier 2, opt-in: an on-demand daemon**, for a watch that needs sub-interval
latency tier 1 cannot give it. It is being built on a sibling branch and is
not runnable here. Conceptually: nothing spawns it but an explicit start
verb, it binds a single instance to a unix socket in the per-user state
directory rather than trusting a pidfile, and it exits itself after a bounded
idle period rather than waiting to be told to stop — so a leaked daemon has
its own backstop.

**Tier 3, opt-in: always-on supervised mode**, for a user who explicitly
wants a process that outlives every firing. It reuses tier 1's generated
units in long-running form with resource limits (`Restart=on-failure`,
memory and task ceilings, no elevated privileges) instead of a oneshot, and
it is scoped to your login session — a personal tool should stop when you log
out. It is also being built on a sibling branch and is not runnable here.

Every tier keeps two things true regardless of which one you pick: nothing
holds a credential in memory between firings (a short-lived child resolves
secrets at use time and exits), and the sterile test harness can never spawn
any of them — each is reachable only through its own explicit verb.

## Installing the default

```bash
construct schedule install --every=6h
```

`--every` takes an hour step that divides a day evenly (`1h`, `2h`, `3h`,
`4h`, `6h`, `8h`, `12h`) or `1d`. A cadence that does not divide the day
evenly is refused rather than approximated, because an approximated calendar
entry is a schedule that silently drifts from what you asked for. `--at`
anchors the time of day (`--at=02:30` on a six-hour cadence fires at 02:30,
08:30, 14:30, 20:30); left off, a daily cadence defaults to 09:00 and a
sub-daily one starts at midnight. Add `--dry-run` to print the generated
entry and the platform commands it would run without writing or loading
anything:

```bash
construct schedule install --every=1d --at=09:00 --dry-run
```

Installing again with a different cadence replaces the entry — the old one
is unloaded first, so you never end up with two schedules fighting over the
same firing. Take it back out with:

```bash
construct schedule uninstall
```

### Doing it by hand

The generated entry is nothing you could not write yourself: a `cron` line,
a raw `launchd` plist, or a systemd timer that runs
`construct standing --due && construct watch --due` on whatever cadence you
choose. If you already manage scheduled jobs some other way, wiring it in by
hand still works — `construct schedule install` exists so you do not have
to, not because the hand-wired form stopped being valid.

## Standing outcomes

Declare the intention once; it runs nothing until something fires it:

```bash
construct standing add --every=7d --workspace=ops \
  "Review the week's roadmap and tracker changes for commitments that no longer agree"
construct standing               # list them, with cadence and last firing
construct standing retire <id>   # stop it; its firings stay on the record
```

The one firing line a schedule (or a hand-wired cron entry) calls:

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
`--due` rather than waiting out another cadence. Declaring with
`--domains=<name,…>` names the staff outright, so an unattended firing spends
nothing on inference; the names are checked against the catalog at
declaration, where a typo costs one retype instead of every firing until
somebody reads the log.

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

The other firing line a schedule calls, exactly as a standing outcome's:

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
construct schedule status  # what tier-1 entry is installed, and its cadence
construct standing         # what stands, and when each last fired
construct watch list       # every declared source watch, and when each last fired
construct inbox            # what needs a human
construct log | tail       # what happened last
construct doctor           # is the machine's install healthy, schedule included
```

`construct doctor` reports the installed schedule's presence and cadence
alongside its other checks; an absent schedule is a normal state and is
reported as one, not as a failure.

## What not to schedule

A grounded run on a large repository against a small local model hits the
host's invocation ceiling and produces nothing (the recorded throughput floor
prints before the spend). Schedule cheap hosts for cheap ground, and give big
ground either a bounded workspace (`source add --workspace=…`, then
`outcome --workspace=…`) or a host that finishes.
