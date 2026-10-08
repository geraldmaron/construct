# Connectors and system semantics

Construct builds no live connectors of its own beyond reading a directory.
It preserves the host-first ladder: in an interactive session the host's own
tools read and write the systems the person already has open, and Construct
records what was read as evidence and gates every write per step. A source
kind with no reader in the current session is reported unreachable, never
empty.

## What a connector declares

A connector declares the kind of system it speaks to, the claim types that
system can supply, the claim types it is commonly mistaken as authoritative
for, what it can read and write and at which tiers, and where its credential
lives (the host, the environment, or the connector), never the kernel and
never a committed file. Authority is not part of a declaration: a project
declares it per claim type.

| System | Supplies | Commonly mistaken for |
|---|---|---|
| GitHub | work items, code changes, components, contributor and review activity | ownership, reporting lines, capacity |
| Jira | work items, initiative links, assignment, status, throughput history | capacity, ownership, priority truth |
| Docs | documents, stated intent, decision records, requirements | current truth |
| HRIS | employment, reporting lines, team membership, titles, headcount | capacity, decision rights, actual collaboration |
| Directory | documents, code components, tests, configuration | — |

## Locators

Each kind has a locator shape and is refused with the expected shape when it
is wrong: `owner/repo` for GitHub, a project key such as `PROJ` for Jira,
`provider:container:id` for docs (Confluence, Google Docs, Notion), an
absolute path for a directory, and a repository reference without embedded
credentials for git.

## Credentials

Never in the kernel and never in a committed file. A locator that carries a
password is refused; a key that names a secret is refused wherever it
appears in a project file.

## A Jira stand-in for testing

Setting `CONSTRUCT_JIRA_FIXTURES` to a directory gives `jira` sources a
reader backed by JSON exports instead of a live tracker. A source with
locator `PLAT` reads `PLAT.json` there: a list of issues, or an object with
an `issues` list, each with a `key`. Every issue becomes an item a step can
cite by key (`PLAT-101`), and its text is kept for checking excerpts and
figures. Reads from a fixture are recorded as reported, not witnessed: a
fixture says what a tracker would have said. Without the variable, a `jira`
source is unreachable as before. `construct doctor` says when jira sources
are reading fixtures, so a forgotten variable cannot pass for a live tracker.

## What the host reads, tracked

Most systems a person works in (a live tracker, a wiki, a drive) are read
by the host through its own tools, not by Construct. So that changes there
are tracked like changes in a folder, the host records what it read with
the `sources` tool, action `report`: each item's reference (a key or page
id), its url (the http(s) address a person would open), title,
last-updated time, and the text it read. Construct keeps a manifest of
those items, marks citations of them as reported, checks quotes against the
recorded text, and on the next report names what was added or modified and
flags finished work that cited it. An item's url is kept from one report to
the next when a later report leaves it out; a url that is not http(s), or
that carries credentials, is refused. The text is kept with anything shaped
like a credential replaced by `[redacted]`, and capped at 16 KiB per item;
the report names any item whose text it cut, and a quote past the cut is
not checked. Whether an item changed is still judged on what the host read,
so a rotated key is a change. A partial report updates only the items it names; nothing is treated as
removed because it was not read. `bootstrap` lists the sources only the
host can read that have never been reported or have gone stale.

## A system the person names, declared from the session

A report needs a declared source. When the person names a system that the
project has not declared (a tracker, a wiki, chat, a monitoring tool), the
host declares it with the `sources` tool, action `declare`: an id, a kind
(`github`, `jira`, `docs`, `hris`, or `other`), and optionally a purpose and
a locator. Pages read from the open web go under one source named `web`
with kind `other`. A report on an id that is not declared is refused with
that remedy. The host reports only the items it cites, with the passage it
relies on.

A source declared this way stays in this machine's state and never reaches
`.construct/sources.json`. It is treated as confidential, it is informative
only, so it settles nothing, and Construct cannot write to it. The activity
log records it as declared by the assistant. A directory or git source is
never declared from a session, because either one lets Construct read files
itself; the person adds those with `construct source add`. The person
commits a declared source with `construct source add <id>` and the same
kind. The committed declaration then governs it, it stays confidential
unless the person names another sensitivity, and what was already read from
it carries over.
