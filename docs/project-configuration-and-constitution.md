# Project configuration and the constitution

Everything Construct knows about a project lives in the project.

## The layout

```text
.construct/
  project.json          identity and behavior configuration (committed)
  constitution.json     what the project is, what must not be violated (committed)
  sources.json          what it reads and what each source may settle (committed)
  registry.lock.json    the skill and workflow versions it resolved (committed)
  skills/               project-authored skills (optional)
  workflows/            project-authored workflows (optional)
  state/construct.sqlite  the only runtime database (ignored by Git)
```

In a git worktree of the project, Construct does not use the worktree's own
`.construct/`. Every command, from any worktree, reads the main checkout's
committed files and uses its one store. Commands that write the committed
files, such as `construct project refresh`, run only in the main checkout,
and `construct project validate` notes when a worktree's copies differ.

There is no home database, no shared workspace, and no settings file. A
file from an earlier alpha is recognized by path or stamp, named exactly,
and never parsed; `construct reset` shows what it would remove and removes
only that when you confirm. A state database in format 2, 3 or 4 is different:
stop every Construct session on the project, then run `construct migrate`,
which writes a backup beside it under `state/` and upgrades it. Read-only
commands refuse an older store and name that step. A store written by a
newer Construct is refused with the instruction to upgrade Construct, never
to reset it: a reset would discard what the newer version wrote.

## Configuration precedence

Five tiers, lowest first: built-in default, per-user presentation defaults,
committed project config, environment variables, explicit flags. Each key
names which tiers may set it: the user file may set only `locale` and
`color`, and the project file may set every key except `color`.

```bash
construct config list
construct config explain locale
construct config set review.cadence weekly
construct config get review.cadence
construct config unset review.cadence
construct config validate
construct config path
```

The keys and their tiers are in [config-reference.md](config-reference.md).
A committed file can never grant consent, carry a secret, name an
executable, or enable external writes; any key that would is refused with
the file and key named.

## The constitution

`constitution.json` is the committed, human-reviewed statement of the
project: name and purpose, scale, lifecycle stage, primary outcome, success
measures, principles, protected constraints and non-goals, canonical
artifacts, owners and decision rights, boundaries, risk posture, review
cadence, glossary, and known unknowns.

It holds only what a person accepted. Discovery proposes; proposals live in
state with their provenance until you confirm them in the host or answer the
setup questions, and the file is composed from confirmed material.

```bash
construct project show
construct project validate
construct project refresh
```

`refresh` re-reads the project's own files and proposes updates; it confirms
nothing. `status` names what is still missing from setup.

## Setup questions and who answers them

`construct init` and `construct project refresh` raise three setup
questions in the inbox: what the project is to you (a side project, your
primary product with just you on it, a team project, several teams' work,
or an organization-wide system), the result that matters most right now,
and what Construct must be careful not to change or violate. Discovery's
guess at the scale is shown with the question and never applied; the
scale stays unset until the person answers. Setup questions never come
before the person's own request: a host handles what was asked first and
asks a setup question only when its answer changes that work, in the same
message. When the person has asked for nothing yet, it puts the open setup
questions to them in one message.

An answer lands wherever the person gives it: relayed by the host with
`decide`, in the host's prompt, with `construct inbox resolve`, or as
`construct init` flags (`--scale`, `--outcome`, `--constraint`). A scale
answer is understood by its id or by the question's own words for it;
anything else is refused with the choices listed. Only the person makes a
project a side project, because that alone makes work lighter: a relayed
answer is put back to the person, and `construct inbox resolve` or
`construct init --scale=side_project` run anywhere but a terminal of the
person's own, outside the agent host, is refused before anything is
written. A constraint an assistant relayed is kept as relayed and never
counts as the person's own rule. Proposed statements are confirmed or
retired with `decide` or `construct inbox resolve`. The inbox names who
decides each item when the constitution names owners for that area. Setup
is confirmed once the name, purpose, scale, and primary outcome are all
set.
