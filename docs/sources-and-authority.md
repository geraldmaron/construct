# Sources and authority

A source is a system or a collection of documents the project reads. Every
source has a purpose, a locator (or a host-resolved reference), an authority
level, the claim types it is authoritative for and the ones it explicitly is
not, a freshness expectation, a sensitivity classification, and read and
write capabilities.

## Declaring sources

```bash
construct source add design --kind=directory --purpose="design documents" --locator=./docs --authority=authoritative --authoritative-for=requirement --not-authoritative-for=capacity --freshness-hours=168
construct source list
construct source show design
construct source refresh design
construct source add tracker --kind=jira --purpose="work tracking" --locator=PROJ --local
construct source relate design governs tracker
construct source retire design
```

Declared sources go into `.construct/sources.json` without credentials; a
locator that carries a password or any key that names a secret is refused.
`--local` keeps a source out of the committed file so a sensitive locator
stays in this checkout. A session can also declare a system the person
named, through the `sources` tool: such a source is local, confidential,
and informative, and never a directory or git source (see
[Connectors and system semantics](connectors-and-semantics.md)).
Committing a local source with `construct source add <id>` under the same
kind makes it declared and keeps what was read from it. It keeps its
sensitivity unless `--sensitivity` names another, and a local locator stays
local when the committed declaration names none.

A relative directory locator is taken relative to the project. `relate`
records how two sources stand to each other; relations are typed (governs,
supersedes, contradicts, depends on, feeds) and checked against what kinds
of things may stand in them.

## Authority is per claim type

A source is authoritative only for what you declare. A work tracker settles
work items, not ownership. An HRIS settles reporting lines, not capacity. A
profile settles nothing. A conclusion counts as settled only when a fresh
claim from a source declared authoritative for that claim type supports it,
or a person confirmed it; every shortfall is named (stale, unread, not
declared, declared not authoritative).

## Freshness and snapshots

`refresh` reads a source through a reader the session has. Only directory
reading ships inside Construct; other kinds read through the host's own
tools in an interactive session or are reported unreachable, never faked. A
snapshot is recorded once per content digest, so an unchanged source records
nothing new, and freshness is judged against the declared expectation.

## Identity and organization

People and teams read from a source are matched by external reference, then
by a recorded alias, then by email, then by normalized name. One match is a
match; several is ambiguous and nothing merges until a person chooses.
Reporting lines, membership, and ownership read from any source are proposals
until confirmed, and the organization view keeps formal structure, declared
ownership, observed collaboration, and inference apart.

## Documents inside a source go stale one at a time

Authority is declared per source, but a source holds many documents and
they age separately. A document that replaces another says so in its first
lines, either `Supersedes: older.md` in the newer one or `Status:
Superseded` / `Superseded by: newer.md` in the older one. A directory read
records that on the item, a citation of the older document resolves with
what replaced it, and the `superseded_acknowledged` check sends back any
output that leans on it without saying so.

## What changed, and what it touched

A directory read fingerprints each file by content, so touching a file is
not a change, and `construct source refresh <id>` reports which files were
added, modified, or removed. When finished work cited a file that then
changed, or drew on a source that gained files, the refresh opens a drift
finding against that deliverable and puts a question in the inbox: revise,
re-run, or dismiss. `bootstrap` names directory sources that moved since
their last read, so a session refreshes before relying on them.

## What the person settles governs

Only the person, on a channel of their own (their terminal, or a prompt the
host shows them), can mark a document or item no longer current, rule a
term out, or replace a record they settled. When the session passes
`outdates` (the names the person said are no longer current), `contradicts`
(the terms a decision rules out), or `replaces` to `remember`, Construct
asks the person to confirm it: in the host's own prompt when the host can
show one, otherwise in the inbox, answered with `construct inbox resolve`.
A decision that only adds is recorded at once; replacing a record waits for
the answer. Once the person confirms that a document is no longer current,
citing it without saying so is sent back, the same as a "Supersedes:"
header. Nothing is read out of a decision's prose: "ADR-004 is outdated" in
the wording of a decision is the decision's wording, not a supersession.

Every statement says whose voice it is in: the person's own, relayed by an
assistant, Construct's inference waiting for review, or no record of how it
arrived. Decisions and constraints in the person's voice reach every step
that reads as settled, with the instruction to list a source that
disagrees with one under conflicts, citing the statement. Ones an assistant
recorded for the person reach those steps on a separate line, as
information to check with them rather than an instruction. A rule-out or
supersession recorded before statements kept their channel has no record of
how it arrived, and restricts nothing until the person confirms it again.
