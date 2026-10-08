# Troubleshooting and recovery

Every failure leads with the problem and then the safe next step; stack
traces appear only with `--debug`.

## No project here

`construct status` and the broker refuse managed work when no project can be
resolved from the working directory up to the repository root. Run
`construct init` in the project. Discovery never crosses into an unrelated
repository.

## A file from an earlier alpha

Init and doctor name any earlier-alpha settings file or format-1
`project.json` they find and refuse to read it. `construct reset` lists
exactly what it would remove; `construct reset --confirm` removes those
paths and recreates clean state, keeping the committed project files unless
you pass `--include-project-files`.

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
reset: upgrade Construct instead.

## The database cannot be opened

`status` exits 1 with the path and the reason; `doctor` reports the state
check failed. Check permissions on `.construct/state/construct.sqlite`, or
reset.

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

## Registry skew

`status` and `doctor` report bundles that are outdated, diverged, missing, or
unlocked. `construct skill update` reconciles the lock; a project-authored
bundle that changed is locked only when you name it with `--confirm`.

## The host does not see Construct

`construct doctor` reports host wiring. `construct init --client=<host>`
writes the host's project MCP file; `construct serve --client=<host>
--describe` prints what the server would serve without starting it.

## Something ran that should not have

The activity table is append-only and records every run transition, lease,
submission, decision, grant, and approval. Read it with `construct run show
<id> --json`, or through `project_context` in the host.
