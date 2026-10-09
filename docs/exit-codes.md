# Exit codes

Every `construct` command returns one of three codes, and no command has ever
returned a fourth. A script driving Construct needs only these three branches.

| Code | Meaning | Examples |
| ---- | ------- | -------- |
| `0` | Succeeded, including an honestly empty result. An empty answer is not a failure — `construct source list` on a project that has declared none, and `construct status` on a project with nothing in flight, both return `0`; an empty project is a valid state, not an error. `construct reset` without `--confirm` returns `0` too: it named its targets and removed nothing, which is what it was asked. |
| `1` | The command's grammar was accepted, but the operation itself could not complete. No project could be found from here, the state database could not be opened or is in a format this version does not read, a file from an earlier alpha is in the way, an id named on the command line does not exist (`construct source show <id>` for a source never declared), a source could not be reached on `construct source refresh`, or `construct doctor` found a failing check. |
| `2` | The command line itself was wrong before anything was attempted — a required flag or argument is missing, a value is not one of the accepted ones, two flags on the same invocation contradict each other. |

`construct hook`, the command a host's lifecycle hooks run, returns `0`
whatever happens once its command line parses: a hook must never be the error
the person sees. A malformed hook command line (an unknown flag, no event
named) still returns `2` like any other command.

`construct <command> --json`, which every read accepts, follows the same three
codes: `--json` changes what a successful call prints, not what "successful"
means.

## Exits outside a command's return

A few paths end the process directly instead of returning a code from the
command. Each still uses one of the three codes, with one case where a
signal ends the process first.

- `main()` in `src/cli/index.ts` exits `0` when a write hits a reader that has
  already gone away (`EPIPE`: `construct help | head -1` closes the pipe
  mid-write). A reader disappearing is a normal end for a CLI, not a failure,
  so the process stops quietly rather than reporting the stack trace an
  unhandled write error would otherwise produce.
- `construct serve`, once it has opened a project's state database, exits
  `0` when the host stops it with `SIGTERM`, `SIGINT`, or `SIGHUP`, after it
  ends the session and closes the database. A serve that has not opened one
  (no project here, or a lazily bound serve before its first call) has
  nothing to close, installs no handler, and is ended by the signal itself,
  as any process would be.
- `construct hook` exits `0` when a coordination hook's time budget runs out,
  so the host never waits on it.
- `bin/construct.mjs` exits `1` before the command line loads when Node is
  older than 22 or cannot load `node:sqlite`.

No other exit path exists outside a command's own `0`/`1`/`2` return.

## Keeping this honest

`tests/cli/exit-codes.test.ts` scans every file in `src/cli/` for numeric
`return` statements and `process.exit()` calls and fails if any value outside
`{0, 1, 2}` appears — the table above is the complete contract, checked
against the source it describes rather than trusted to stay in sync with it
by hand.
