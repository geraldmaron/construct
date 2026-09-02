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
stays in this checkout.

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
