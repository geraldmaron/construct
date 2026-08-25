# Exit codes

Every `construct` verb returns one of three codes, and no verb has ever
returned a fourth. A script driving Construct needs only these three branches.

| Code | Meaning | Examples |
| ---- | ------- | -------- |
| `0` | Succeeded, including an honestly empty result. An empty answer is not a failure — `construct log` on a run with no entries, `construct lessons` on a workspace with none recorded, and `construct show --run <id> --json` on a run with no tasks all return `0`. |
| `1` | The command's grammar was accepted, but the operation itself could not complete. A store could not be opened, an id named on the command line does not exist, a write was refused by a downstream check, a host errored while a command tried to reach it. |
| `2` | The command line itself was wrong before anything was attempted — a required flag or argument is missing, a value is not one of the accepted ones, two flags on the same invocation contradict each other. |

`construct <verb> --json`, wherever a verb offers it, follows the same three
codes: `--json` changes what a successful call prints, not what "successful"
means.

## The one exception

`main()` in `src/cli/index.ts` calls `process.exit(0)` directly, bypassing a
verb's own return value, exactly once: when a write hits a reader that has
already gone away (`EPIPE` — `construct outcome … | head -1` closes the pipe
mid-write). A reader disappearing is a normal end for a CLI, not a failure, so
the process stops quietly rather than reporting the stack trace an unhandled
write error would otherwise produce. No other exit path exists outside a
verb's own `0`/`1`/`2` return.

## Keeping this honest

`tests/cli/exit-codes.test.ts` scans every file in `src/cli/` for numeric
`return` statements and `process.exit()` calls and fails if any value outside
`{0, 1, 2}` appears — the table above is the complete contract, checked
against the source it describes rather than trusted to stay in sync with it
by hand.
