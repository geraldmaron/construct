# Running Construct on a schedule

Construct has no scheduler of its own, and that is a current fact rather than
a principle — a first-class standing outcome is tracked in the backlog. What
exists today is enough to run it as a scheduled team member, because every
spine command is idempotent and everything lands in one auditable store: an
outcome files work, `work` runs whatever is queued and only that, decisions
wait in the inbox, and a re-run never duplicates what already settled.

## The recipe

One scheduled invocation is an outcome plus the work that runs it:

```bash
construct outcome --host=claude --workspace=ops \
  "Review the week's roadmap and tracker changes for commitments that no longer agree" \
&& construct work --ceiling=5
```

Schedule it with whatever the machine already trusts — `cron`, `launchd`, a CI
job. The pieces behave the way a scheduled task needs:

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

## Checking on it

```bash
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
