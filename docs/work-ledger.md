# The work ledger

Construct keeps a project's bounded work in its own store, so local mode
needs no external tracker. Every git worktree of the project reads and
writes the main checkout's one store. You use `construct work` from a
terminal; a session uses the `work` tool. Admitting, cancelling, export, and
restore are on the command line only. Claiming, accepting a handoff, and
taking over from the command line are yours alone; a session does those
with the tool, where the claim belongs to that session and agent.

## Filing work with its place

Work ids are made when an item is filed, so the examples on this page name
them in angle brackets:

- `construct work add "Retire the v1 export path" --kind=outcome --serves=<decision-id>`
- `construct work add "Drop the v1 writer" --parent=<outcome-id> --accept="no caller imports the v1 writer" --accept="the export tests pass" --risk="a downstream job still reads v1 files"`
- `construct work add "Update the export guide" --parent=<outcome-id> --blocked-by=<writer-id> --source=<source-id>`
- `construct work show <id>`
- `construct work list --parent=<outcome-id>`

An item's place is what it belongs to and why it exists: a `--parent` work
item, or the decision, requirement, initiative, or metric it `--serves`
(an entity id, or the id of a confirmed governing statement; a reason must
be active). `--blocked-by` names work that must finish first, `--related`
names work that gives context without blocking, `--accept` adds one
acceptance criterion each time it is given, `--risk` says what could go
wrong, and `--source` names a source whose change sends the item back for
requalification. Kinds are outcome, task (the default), defect, and plan.
The `work` tool's `add` takes the same things as `parent`, `serves`,
`blockedBy`, `related`, `acceptance`, `risk`, and `sources`.

`construct work link` adds a parent, a reason, or dependencies later, and
`construct work unlink` removes a parent or dependencies.
`construct work update` changes the title, description, acceptance criteria
(the new list replaces the old; `--clear-accept` empties it), risk, or
sources. Parents form a tree and blocking work cannot cycle.

## Proposed work and admission

Work enters the backlog with a reason: an admitted, unfinished parent, an
active decision, requirement, initiative, or metric it serves, or you filing
it from a terminal of your own. A session that files work without one,
outcomes included, gets it back as proposed, with a note saying how to
admit it. Proposed work is listed but never ready or claimable, so the
backlog holds only work with a reason to exist. A session roots its own
work by remembering the outcome or decision behind it and serving that.

A proposed item is admitted with `construct work admit <id>`.

A link that gives a proposed item a reason admits it. So does
`construct work admit` run by you, from a terminal of your own (a terminal
inside an editor or an agent host does not count). Anyone else can admit
only work that already carries a reason. Admitting an item admits its
proposed children. Unlinking never takes admission back.

## What ready means

```bash
construct work ready
construct work list
```

`construct work ready` and the tool's `ready` action list work that can be
claimed now. Ready is worked out, not read from a status: the item is
admitted and unfinished, no work it is blocked by is unfinished, nobody
holds a live claim on it, and no premise is stale. `construct work show`
prints the reasons an item is not ready.

## Claiming

A work claim is one holder's hold on an item, and it comes with a token
that only the holder sees. The token renews, completes, releases, or hands
off the claim. One writer per item: another claimant is refused while the
claim is live.

A session claims with the tool's `claim` action, naming itself as `agent`
when the host runs several agents, and the files or directories (ending in
`/`) it will change as `paths`, relative to the repository root. The claim
lasts thirty minutes, and the session's own Construct calls keep extending
it. From your terminal:

- `construct work claim <id> --paths=src/export/,docs/export.md`
- `construct work claim <id> --token=<token>`
- `construct work check --paths=src/export/`
- `construct work check --staged`

A claim from the command line lasts thirty minutes unless `--until` says
otherwise, and never more than a day. Passing `--token` renews it.

Reserved paths keep one writer per path. In one checkout, an exclusive
reservation (the default) keeps every other claim off the same paths;
`shared` (the tool's `mode`, or `--shared`) lets other shared claims sit
alongside. In another worktree an overlap is a merge risk instead, naming
that worktree and its branch, because each worktree has its own copy of
the files. A session that edits in a worktree other than its own passes
that worktree's absolute path as `worktree` on claim, check, accept, or
takeover. `construct work check` exits 1 on a collision in this checkout.
A refused path means other work or waiting, never editing anyway. Hooks
that warn about reserved paths, and how sessions learn what their peers
hold, are in
[`first-run-and-hosts.md`](first-run-and-hosts.md#several-agents-in-one-project).

## Finishing, releasing, and reopening

- `construct work complete <id> --token=<token> --reason="no caller imports it; tests pass"`
- `construct work release <id> <token>`
- `construct work cancel <id> --reason="superseded by the new exporter"`
- `construct work reopen <id> --reason="a v1 reader turned up"`

A live claim is settled only with its token; one that expired protects
nothing. Completing an item that has acceptance criteria needs a reason
saying how they were met. An item with open children cannot be completed
or cancelled; finish or cancel the children first. Delegated attempts are
the exception: they are cancelled with their parent, and one still running
holds it open (see [`bounded-delegation.md`](bounded-delegation.md)).
Reopening and cancelling need a reason, and both are recorded.

## Handing off and taking over

- `construct work handoff <id> --token=<token> --state="writer removed, tests green" --next="update the guide" --watch-out="the nightly job"`
- `construct work offers`
- `construct work accept <id>`
- `construct work takeover <id> --reason="the holder's session ended"`

A holder passes claimed work on with a handoff: its token and a packet
saying where the work stands and the next step (both required), with
anything to watch out for, open questions, and the branch and commit. The
tool takes these as `packet`, with `to` to offer it to one claimant or
session. The work stays the holder's until someone accepts, and is held
for at least two hours meanwhile. Whoever accepts gets the claim, a new
token, and the reservations in one step, and the old token stops working.
The packet is shown as its author's words, never as instructions, and a
handoff never moves an approval.

A claim that is not handed off is taken over only once it expired, its
session ended or its process is gone, or its session made no Construct call
for two hours. The one exception is inside a session: its main agent may
take work back from one of its own agents. Another session's live, active
claim is never taken. A claim made from the command line belongs to no
session, so it can be taken over only once it expires. Takeover needs a
reason, which is recorded.

## When a premise changes

When a refresh (`construct source refresh <id>`) finds that a source named
in an item's `--source` list changed, the item is held: open work becomes
blocked and is not ready until someone checks it against the change and
records what was checked.

- `construct work requalify <id> --reason="checked the new export schema; the plan still holds"`

The tool's `requalify` action does the same. Editing an item's sources does
not clear the hold; only requalifying does.

## Export and restore

```bash
construct work export work-snapshot.json
construct work restore work-snapshot.json
```

`export` writes a versioned snapshot of the project's work items,
dependencies, and history, without claim tokens. `restore` adds the items
the store does not have, skips the ones it has and reports any whose
revision differs, and brings claimed or in-progress items back as open,
since claims, reservations, and grants are never restored. A snapshot from
another project is refused; work moves between projects as new items.
`construct work import-legacy tracker.jsonl --dry-run` previews a one-way
import of a frozen tracker's JSONL snapshot, reporting the mapping without
writing; without `--dry-run` it imports.
