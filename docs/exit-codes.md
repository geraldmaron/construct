# Exit codes

Every `construct` command returns one of three codes, and no command has ever
returned a fourth. A script driving Construct needs only these three branches.

| Code | Meaning | Examples |
| ---- | ------- | -------- |
| `0` | Succeeded, including an honestly empty result. An empty answer is not a failure — `construct source list` on a project that has declared none, and `construct status` on a project with nothing in flight, both return `0`; an empty project is a valid state, not an error. `construct reset` without `--confirm` returns `0` too: it named its targets and removed nothing, which is what it was asked. |
| `1` | The command's grammar was accepted, but the operation itself could not complete. No project could be found from here, the state database could not be opened or is in a format this version does not read, a file from an earlier alpha is in the way, an id named on the command line does not exist (`construct source show <id>` for a source never declared), a source could not be reached on `construct source refresh`, or `construct doctor` found a failing check. |
| `2` | The command line itself was wrong before anything was attempted — a required flag or argument is missing, a value is not one of the accepted ones, two flags on the same invocation contradict each other. |

`construct <command> --json`, which every read accepts, follows the same three
codes: `--json` changes what a successful call prints, not what "successful"
means.

## The one exception

`main()` in `src/cli/index.ts` calls `process.exit(0)` directly, bypassing a
command's own return value, exactly once: when a write hits a reader that has
already gone away (`EPIPE` — `construct help | head -1` closes the pipe
mid-write). A reader disappearing is a normal end for a CLI, not a failure, so
the process stops quietly rather than reporting the stack trace an unhandled
write error would otherwise produce. No other exit path exists outside a
command's own `0`/`1`/`2` return.

## Keeping this honest

`tests/cli/exit-codes.test.ts` scans every file in `src/cli/` for numeric
`return` statements and `process.exit()` calls and fails if any value outside
`{0, 1, 2}` appears — the table above is the complete contract, checked
against the source it describes rather than trusted to stay in sync with it
by hand.
