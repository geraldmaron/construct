# Troubleshooting and recovery

Every failure leads with the problem and then the safe next step; stack
traces appear only with `--debug`.

## No project here

`construct status` and the broker refuse managed work when no project can be
resolved from the working directory up to the repository root. Run
`construct init` in the project. Discovery never crosses into an unrelated
repository.

In a git worktree, Construct uses the project and the one store in the
repository's main checkout; when that checkout has no project, run
`construct init` there.

## The project files are missing but the store remains

A checkout whose current commit does not carry `.construct/project.json`
can still hold the project's store under `.construct/state/`. Commands there
say so and ask you to restore the `.construct` files, for example by
checking out the commit that has them. `construct init` refuses to run over
such a store, because a new project id would orphan it; `construct reset`
discards the store instead.

## A file from an earlier alpha

Init and doctor name any earlier-alpha settings file or format-1
`project.json` they find and refuse to read it. `construct reset` lists
exactly what it would remove; `construct reset --confirm` removes those
paths and recreates clean state, keeping the committed project files unless
you pass `--include-project-files`. It refuses while another process has the
state database open and names the process (`--force` removes it anyway), and
in a git worktree it refuses and names the main checkout to run it in.

```bash
construct reset
```

## The state is in an older format

Every command refuses a store an older Construct wrote and names
`construct migrate`. Stop every Construct session on this project first
(close its agent sessions, or stop their MCP servers): a session still
running an older Construct would go on writing to the store after the
upgrade, without the new format's protections. Then:

```bash
construct migrate
```

It refuses while another process has the store open and names the process;
`--force` upgrades anyway. It copies the store to
`.construct/state/construct.pre-v<format>-<time>-<id>.sqlite` under the
upgrade's own write lock, upgrades it in place, and prints the backup's path.
If the upgrade fails without changing the store, the copy is removed and
nothing is left to clean up. A store written by a newer Construct is never
reset: upgrade Construct instead. A store in a format this version cannot
read at all, or one missing a table its format needs, is refused unread;
`construct reset` names what it would remove, and `construct reset --confirm`
removes it and recreates clean state, keeping the committed project files.

## The database cannot be opened

`status` exits 1 with the path and the reason; `doctor` reports the state
check failed. Check permissions on `.construct/state/construct.sqlite`, or
reset. `status` and `doctor` read a store in a state directory you cannot
write when its write-ahead log is empty or a running session has the store
open; otherwise they say what access the read needs.

The store records its project's id. Every command that opens the store
refuses a store stamped for another project than the one
`.construct/project.json` names, and so does `construct migrate`, because
one store is one project; `doctor` reports it as the `state-project` check. Restore the `.construct/project.json`
that names the store's project, or move the store aside before running
`construct init`. A store another session is writing to is reported busy,
not damaged: try again in a moment.

## A workflow is blocked

`construct workflow resolve <id>` and `construct run show <id>` list every
reason with a remedy: a missing source, a stale one, a capability the host
does not provide, a skill version out of range, a diverged lock. Clear the
reason and `construct run resume <id>`.

Starting the same work again settles a blocked run too. With the same input,
the blocked run is checked again where it stands and goes ahead once nothing
blocks it. With corrected input, including an input it left out, a new run
starts and the blocked one is cancelled, its reason naming the run that
replaced it. A blocked run of other work, such as one that names a different
target, is left alone; `construct run cancel <id>` retires it. A claim on a
blocked run returns its reasons and what would clear each one.

A run whose workflow changed after it started, or whose next step binds a
skill that changed since, stops at `re_resolve` when it is claimed, for
example after upgrading Construct. It cannot continue: cancel it with
`construct run cancel <id>` and start the work again.

## Registry skew

`status` and `doctor` report bundles that are outdated, diverged, missing,
unlocked, or blocked (locked at a newer version than the one present).
`doctor` fails on diverged, blocked, or missing ones, and a run that uses
one is blocked until the lock is reconciled. `construct skill update`
reconciles the lock; a project-authored bundle that changed is locked only
when you name it with `--confirm`.

## The host does not see Construct

`construct doctor` reports host wiring, and fails when no host is wired.
`construct init --client=<host>` writes the host's project MCP file and plants
the operational skill where that host reads it; `construct serve
--client=<host> --describe` prints what the server would serve without
starting it. A host needs its one-time step before it sees Construct: in
Claude Code, a new session and approving the `construct` server
(`claude mcp get construct` shows whether it is pending, approved, or
rejected).

A host file starts `construct serve` from PATH, or `npx --no-install
construct` when Construct is a project dependency, so each teammate needs
Construct on PATH or as a project dependency. `doctor`'s `host-launch:<host>`
check says whether the command each wired host's file starts can be found
from this shell. A host file that names an absolute path to Node or to
Construct's install works on one machine only; when that path no longer
exists (another machine's, or an old Node's), `doctor` reports it broken, and
`construct init --client=<host>` rewrites it. For Claude Code, `doctor` fails
`host-hooks` while old Construct hooks remain in the shared
`.claude/settings.json`, or after a Node upgrade until a server starts and
repoints the hooks' launcher; `construct init --client=claude-code` repairs
them.

The server starts even when it cannot bind. While another process holds
the store, it answers the host at once and binds on the first tool call
after the lock clears; until then a call says the store is busy and records
nothing. When there is no project, or the state is in an older or newer
format, `bootstrap` says so and names the step to run, such as
`construct init` or `construct migrate`.

## Something ran that should not have

The activity table is append-only and records every run transition, lease,
submission, decision, grant, and approval. Read it through
`project_context` in the host (topic `activity`); `construct run show <id>
--json` gives a run's steps, deliverables, and open decisions, with only a
count of its activity events.
