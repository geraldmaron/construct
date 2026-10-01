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
