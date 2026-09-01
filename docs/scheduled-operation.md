# Running Construct on a schedule

Routines are manual. There is no resident sweeper, platform timer verb, or
standing-outcome CLI. Recurring work is declared and run with:

```bash
construct routine create …
construct routine run --id=<id> --pin=<executor>
```

Create the routine once; run it when you want it to fire — by hand, or from
whatever clock you already own (cron, launchd, a CI schedule). Construct does
not install or supervise that clock.

## What that means

- **No `construct standing`.** Recurring intentions live as Routines.
- **No `construct schedule`.** Platform unit generation is gone.
- **No `construct daemon`.** Nothing resident sweeps due work.
- **No `construct watch` CLI.** Kernel source-watch code remains for ground
  comparison; there is no product verb that declares or fires watches.

## Checking on it

```bash
construct routine list
construct inbox
construct log | tail
construct doctor
```

## Ceiling and audit

When you drive work through `construct work` (or a routine run that claims
through a pin), `--ceiling` still bounds spend across recorded runs, inbox
decisions still do not block the schedule you wired yourself, and
`construct log --run <id>` remains the auditable record.
