# Systems that span several repositories: design (2026-10-08)

Design only. Nothing under `src/` changed with this document. It was read
against `staging` at `79562bbc` and, for the in-flight evidence work, against
the evidence lane `feat/ti-evidence` at `5e104e34`, which branched from
`feat/typed-intake` at `8240f109`; the same evidence commits also sit on
`feat/typed-intake` at `1cd73ab9`, with identical evidence files. The
stricter citation resolver described below is in `5e104e34`, not in its
parent `cb93fc8e`, where any `https://` address still resolves. Host facts
were checked against each host's own documentation on 2026-10-08 and cite
it; anything that could not be checked is marked unverified.

## 0. Outcome first

**Recommendation: commit what a sibling repository is, and record where it
sits on each machine.** A sibling becomes a `git` source whose locator is
its remote identity (`github.com/acme/payments`), with an optional relative
hint (`../payments`). On each machine a person binds it once
(`construct source bind payments`). Construct checks that the checkout
really has that remote before it reads anything, then reads the committed
tree at HEAD and records the commit it read. Where nothing is bound, the
same source is read through the host's GitHub connector and recorded as
reported, so a machine without the clone degrades instead of failing.

What it changes, smallest first:

1. In-project directory sources commit a relative path instead of an
   absolute one (four functions, no new concept).
2. A `git` reader, plus a per-machine binding recorded as an observation
   (no new table, no state format change).
3. `canRead` and `reportRead` decide per source instead of per kind, so one
   source is read here and reported on a machine without the clone.
4. After the evidence branch merges, a GitHub file address in a citation
   resolves to the recorded item only when it names the version that was
   recorded.
5. Architecture maps cite both ends of every cross-repository edge, checked
   by one new validator.

Top risks, with controls in section 6:

1. **Witnessed, but the wrong tree.** A stale branch or a fork gets cited
   with the strongest provenance Construct has.
2. **Read scope widens beyond the project.** A committed declaration points
   Construct at files outside the repository on every machine.
3. **Running git inside a repository Construct does not own** can run
   commands that repository's configuration names.

Found on the way, and blocking slice 2: every refresh of a source
Construct reads itself appends one claim per item, changed or not, and two
sources that hold the same path share one entity (section 2.4). A sibling
repository would multiply the first by its file count and hit the second on
its first read.

Status: the design is complete. Implementation was not attempted. No
decision here needs Gerald: STRATEGY 1 holds as written, nothing costs
money, and nothing goes outward. Next action: file the items in section 8
under the parent outcome and start with slice 1.

## 1. Where the code stands

- `construct source add docs --kind=directory --locator=./docs` resolves the
  path against the project root in `declaredFrom` (`src/cli/source.ts`) and
  commits the absolute result to `.construct/sources.json`. On another
  machine that path does not exist: `construct init` syncs the declaration
  and the first refresh reports it unreachable. In this repository
  `scripts/lint-no-absolute-paths.mjs` would also fail on the committed file.
- Writing `docs` by hand does not help. `directoryLocatorProblem`
  (`src/kernel/source/locators.ts`) refuses a relative locator, and
  `syncDeclarations`, which `init` runs, refuses the declaration.
- `readDirectorySource` (`src/hosts/sources/directory.ts`) calls
  `resolve(locator)`, which resolves against the process's working
  directory, not the project. Only the evidence resolver
  (`createEvidenceResolver`, `src/kernel/project/evidence.ts`) already
  resolves a directory locator against the root.
- A sibling repository today is either an absolute `directory` source
  (committed, so machine-specific) or a `--local` one (portable, but
  teammates never learn it exists). Nothing records which repository a
  folder is, or which commit was read. The directory reader reads the
  working tree, untracked files included.
- The `git` kind exists with a locator check that refuses credentials
  (`gitLocatorProblem`), but no reader. The `github` kind takes
  `owner/repo` and is read only by the host.
- Half of a "committed versus here" split already exists: `declare` in
  `createSourceService` keeps the stored locator when the committed one is
  null, and the service has `setLocalLocator`. Nothing calls
  `setLocalLocator`.
- `canRead(id)` and `reportRead` decide by kind
  (`deps.readers.has(source.kind)`), so one source cannot be read on one
  machine and reported on another.
- On `staging`, every `https://` reference resolves as `web` with provenance
  reported, whether or not anything was read. The evidence branch replaces
  that with "only what a recorded read holds" (section 3).
- Relations in the context graph (`addRelation`,
  `src/kernel/state/graph.ts`) carry a basis and a source id but no
  evidence references, so a graph relation cannot cite its two ends.

## 2. Naming sibling repositories portably

### 2.1 The options

| Option | What is committed | On a new machine | Knows which repository it is | Same name the connector uses | Read-scope exposure |
|---|---|---|---|---|---|
| Relative paths (`../payments`) | a place | works only if the layout matches | no: any folder at that place passes | no | a committed `../../.ssh` reaches the same place on every machine |
| Git remote URLs, found by searching the disk | an identity | works after a search | yes | yes | the search reads widely; forks and several clones are ambiguous |
| A per-machine mapping file kept out of git | nothing | manual setup, every time | only if the file says so | no | small, but a second file format and an ignore line to get wrong |
| **Identity committed, optional relative hint, binding recorded per machine** | an identity and a hint | one command, exact in the usual layout | yes, checked against the checkout's remotes | yes | nothing outside the project is read until a person binds it on that machine |

Relative paths alone are the cheapest and the most dangerous: the same
portability that makes `../payments` work everywhere makes a hostile or
mistaken path work everywhere too, and a path says nothing about what is
there. Remote URLs alone name the right thing but need a search to find it.
A mapping file is exact but is a new format that repeats what the state
database already does. The recommended option takes the identity from the
second, the hint from the first, and stores the per-machine part in the
git-ignored store Construct already keeps, which is a mapping kept out of
git without a new file.

### 2.2 The declaration

```json
{
  "id": "payments",
  "kind": "git",
  "purpose": "the payments service: charges, refunds, the ledger",
  "locator": "github.com/acme/payments",
  "relativePath": "../payments",
  "authorityLevel": "authoritative",
  "authoritativeFor": ["code_component"],
  "sensitivity": "internal"
}
```

- `locator` is the repository's identity: host and path, no scheme, no
  credentials, no `.git` suffix. `https://github.com/Acme/Payments.git`,
  `git@github.com:acme/payments.git` and `ssh://git@github.com/acme/payments`
  all normalize to `github.com/acme/payments`, and a `github` source's
  `acme/payments` normalizes to the same identity. Lowercasing the path on
  `github.com` assumes GitHub matches owner and repository names without
  regard to case (unverified).
- A local path or a `file://` address is not an identity.
  `gitLocatorProblem` refuses it and names `--kind=directory --local`.
- `relativePath` is optional, relative to the main checkout's root (the
  root Construct already binds linked worktrees to), and may climb. It
  describes where the clone usually is and never causes a read by itself.
  It has the same name and meaning as the `related: [{id, relativePath}]`
  entry the multi-agent coordination design approved for related Construct
  projects (its decision D2), so one resolution function can serve both.
- Older Construct versions ignore the extra key when they read the file and
  see a `git` source with no reader, which they report unreachable. When
  they rewrite the file (`construct source add` or `remove`), they drop the
  key, because the `add` and `remove` cases of `sourceCommand` write what
  `validateSourcesFile` returns, and it returns only the fields it knows.
  The hint is lost, not the source: `construct source bind payments <path>`
  still binds.

### 2.3 Binding on each machine

- `construct source bind payments` binds the hinted folder;
  `construct source bind payments ~/work/payments` binds another.
  `construct source bind --all` binds every `git` source whose hint
  verifies and lists what it bound, so a new machine is one command after
  `init`. `construct source unbind payments` records a binding to nothing.
- A person runs it from the command line. No MCP tool binds, for the reason
  the evidence branch already gives for keeping `directory` and `git`
  declarations away from sessions: they let Construct read files itself.
  This is also what STRATEGY 1 asks for. The committed file describes the
  repository; the binding, made on that machine by its person, is what lets
  Construct read it.
- Before recording a binding, Construct checks that one of the checkout's
  remotes normalizes to the declared identity. Any remote counts, so a fork
  whose `upstream` names the canonical repository binds. A folder with no
  matching remote is refused, and the refusal lists the remotes it found.
- The binding is a `source.checkout` observation on the source, written with
  `recordObservation` and read back with `latestObservationWith`
  (`src/kernel/state/drift.ts`), the way the current manifest rides on
  `source.changed`. It lives in the git-ignored store, per machine, with its
  history. A new table would be a required table in a format-4 store, which
  means a format 5 and a migration; the observation needs neither.

### 2.4 What a read of a bound checkout records

- **The committed tree at HEAD, not the working tree.** The reader lists it
  with `git ls-tree -rz HEAD`, run the hardened way the delegation workspace
  already runs git (`src/hosts/delegation/workspace.ts`: no hooks path, no
  fsmonitor, no system or global git configuration, no prompts), because
  git run inside a repository can otherwise run commands that repository's
  own configuration names.
- **One item per tracked file.** The ref is the repository-relative path and
  the fingerprint is the git blob id. Paths matching the private-path
  pattern the delegation workspace already applies (`.env` files, keys,
  host control folders) are left out and counted. Symlinks and submodules
  are reported, not followed. The directory reader's 5,000-item cap applies.
- **The version read:** `revision` (the HEAD commit), `branch`, the commit
  time, and whether the checkout has uncommitted changes. Uncommitted
  changes are not part of the read, and the read's summary says so.
- **An address per item** when the identity's host is `github.com`: the
  permanent link at the commit read,
  `https://github.com/<owner>/<repo>/blob/<commit>/<path>`, the shape GitHub
  documents for permanent links. A citation of that address meets the
  witnessed item.
- **Provenance witnessed.** Item changes come from blob ids, so a refresh
  names exactly which files changed between two commits.
- **No stored text.** When a citation needs text (an excerpt check), the
  resolver reads the file in the checkout and computes its blob id (SHA-1
  over `blob <size>\0` plus the bytes, as Git defines it). When that matches
  the recorded id, the text is the recorded version and the excerpt is
  checked. When it does not (the file was edited, or a line-ending or
  clean filter changes the bytes), the citation resolves without text and
  the excerpt is unchecked, the rule the evidence branch already uses for
  text cut at the cap. A repository using SHA-256 object names needs the
  other hash.
- **A prerequisite found while designing this.** `recordRead` in
  `createSourceService` adds one observed claim per item on every refresh of
  a source Construct reads itself, whether or not anything changed: the
  claim block is not guarded by `changed`. A scratch run against this
  branch (a sterile store, a three-file directory source, three refreshes)
  counted 3, 6, then 9 claims, with the second and third refreshes reported
  unchanged. A sibling repository of a few thousand files would add that
  many rows per session.
- **A second prerequisite, which several repositories make certain.**
  `recordRead` finds the artifact entity for an item by its bare ref
  (`findEntityByRef(store, 'artifact', item.externalRef)`), and entities are
  unique by kind and external ref across the whole store. Two sources that
  both hold `README.md` share one entity. A scratch run (a sterile store, two
  directory sources each with a `README.md`, one refresh each) recorded one
  entity carrying both sources' claims. Almost every repository has a
  `README.md` or a `package.json`, so sibling repositories would merge
  entities on their first read. The identity module already qualifies an
  external ref by its source (`aliasRef` in `src/kernel/source/identity.ts`
  writes `<sourceId>:<ref>`); `recordRead` should key artifact entities the
  same way.
- The multi-agent coordination plan already lists both among its
  directory-source repairs ("Entities keyed by `(source_id, path)`" and
  "refresh supersedes instead of appending"). They have to land before or
  with slice 2.

## 3. Repositories read through a host connector

### 3.1 What "checked" can mean

Construct cannot open GitHub itself. For a connector read it can check
three things: that a citation names an item a recorded read holds, that a
quote appears in the text that read kept, and that the version cited is the
version recorded. The provenance stays reported, because the host says what
GitHub returned. That is the honest ceiling, and a deliverable's provenance
counts already show how much rests on it.

### 3.2 One repository, one source

When a `git` source is not bound on this machine, the host reports what it
read from that repository into the same source; it does not declare a
parallel `github` one. When the source is bound, Construct reads it and
refuses a report, as it does for directory sources today. Per machine, a
source's manifest is then all witnessed or all reported, which keeps true
the single provenance `currentManifestRecord`
(`src/kernel/source/manifest.ts`) gives a manifest.

### 3.3 The report for a repository file

```json
{
  "ref": "src/routes/charges.ts",
  "url": "https://github.com/acme/payments/blob/9f8e7d6c5b4a39281706f5e4d3c2b1a098765432/src/routes/charges.ts",
  "fingerprint": "the blob sha the read returned",
  "updatedAt": "2026-09-30T14:02:11Z",
  "title": "src/routes/charges.ts",
  "text": "the file text the host read"
}
```

- `ref` is the path, so `payments:src/routes/charges.ts` names the same file
  whether it was read on disk or through the connector.
- `url` is the permanent link at the commit the host read. The evidence
  branch keeps it across later reports, refuses one that carries
  credentials (`urlProblem`), and indexes it so a citation of the address
  means this item.
- `fingerprint` is the blob sha when the tool returns one. GitHub's contents
  API returns a file's blob `sha`; whether the GitHub MCP server's
  `get_file_contents` passes it to the model is unverified. A blob sha
  equals the local reader's fingerprint for the same bytes, so the two read
  paths agree about identical files. The `sources` tool's report parsing
  (the `sources` definition's `validate` in `src/kernel/broker/tools.ts`)
  does not accept `fingerprint` today and needs to.
- `updatedAt` is the time of the last commit that touched the file, when the
  host looked it up (the GitHub MCP server's `list_commits` takes a `path`).
  Without a fingerprint, `reportRead` already uses `updatedAt` as the
  version, as it does for tickets.
- Text over 16 KiB is cut and marked on the evidence branch, and a quote
  past the cut is unchecked rather than called a misquote. GitHub's
  contents API supports every feature only up to 1 MB; from 1 to 100 MB
  only its raw and object media types work, and the object type returns an
  empty `content`. [18]

### 3.4 How a GitHub address in a citation resolves

A new `forgeFileOf(url)` beside `normalizeUrl` in
`src/kernel/project/urls.ts` (a file the evidence branch adds) reads
`https://github.com/<owner>/<repo>/blob/<ref>/<path>` into an identity, a
ref and a path. The resolver tries it before the plain address index: it
finds the active source with that identity and the item at that path, and
resolves only when the cited ref is the version the read recorded, meaning
the commit in the recorded `url`, or a local read's revision or branch. A
commit Construct does not hold does not resolve under `hostReads: require`
and resolves as unverified under `accept`. A citation of `blob/main/...`
does not meet a local read of branch `old-refunds`. Nothing here brings
back "any https address resolves".

### 3.5 Stronger recording, later

The post-tool hook (`onPostTool`, `src/hosts/hooks/handlers.ts`) records
Jira items from the connector's own response rather than from the model's
restatement; on the evidence branch it takes them only from tools whose
name says jira or atlassian, and names the tool in `via`. The same handler
can record file reads from tools whose name says github, on hosts that run
post-tool hooks. The record then comes from
what the tool returned. The GitHub connectors' tool names and response
shapes per host are unverified, so this waits for a live check.

### 3.6 How this composes with the in-flight evidence branch

| On the evidence branch | How this design uses it |
|---|---|
| `sources` action `declare`: a session declares a system the person named (github, jira, docs, hris, other); it stays on this machine, confidential, informative; `directory` and `git` stay with the person | A repository the person names in chat ("payments is acme/payments") can be declared and read through the connector the same day. Making it a witnessed `git` source stays a person's act. One addition: `declare` refuses a `github` source whose identity matches an active source and names that source. |
| Reported items keep their `url`, refused when it carries credentials | Connector reads report the permanent link; the `git` reader stamps the same link on witnessed items, so both read paths meet one address. |
| The citation resolver accepts only what Construct holds (`normalizeUrl`, the address index, `unverified` only under `accept`) | `forgeFileOf` is one more way to find a recorded item. It never admits an unrecorded address. |
| Stored text has credential shapes redacted and is marked when cut | The `git` reader stores no text, so it adds nothing to redact. The resolver reads checkout text only to check an excerpt, the way it reads project files today. |

Slice 3 in section 7 lands after the evidence branch merges and builds on
its functions, and so does step 7 of slice 2, which changes
`createEvidenceResolver` after that branch rewrites it. The rest of slices
1 and 2 sits beside that branch's edits: in `src/kernel/source/service.ts`
it changes `syncDeclarations`, `recordRead` and the body of `reportRead`,
while this design changes `refresh`, `peek`, `canRead` and the guard at the
top of `reportRead`; in `src/cli/source.ts` it changes the `add` case of
`sourceCommand`, while this design changes `declaredFrom`; in
`src/kernel/project/sources-file.ts` it moves the credential check inside
`validateSourcesFile` into `locatorCarriesCredentials`, while this design
adds `relativePath` to the same function's output.

## 4. Citing cross-repository edges

An edge in an architecture map ("web calls payments: POST /charges") is a
claim about two repositories. It cites both ends: the call site in the
caller and the handler in the callee. When configuration joins them (a URL
in a deploy manifest, a topic name, a shared client package), it cites that
too.

```json
{
  "from": "web",
  "to": "payments",
  "kind": "calls",
  "via": "HTTP POST /charges",
  "evidence": [
    { "ref": "web:src/payments/client.ts:40-52", "excerpt": "fetch(`${PAYMENTS_URL}/charges`" },
    { "ref": "payments:src/routes/charges.ts:12", "excerpt": "router.post('/charges'" },
    { "ref": "infra:deploy/web.yaml:31", "excerpt": "PAYMENTS_URL: http://payments" }
  ]
}
```

1. Each node names the source its system lives in, and each end of an edge
   cites at least one item from its node's source.
2. An edge's provenance is the weaker of its ends: witnessed at both ends,
   reported at one or both, or one-sided when an end has no citation. A
   one-sided edge stays in the map, labeled inferred with the reason, and is
   never drawn like the others.
3. The map says what it was drawn from, per source: `web at 1a2b3c4 (main)`,
   `payments at 9f8e7d6 (main; uncommitted changes not read)`,
   `infra reported through the GitHub connector, read 2026-10-08`.
4. Staleness needs nothing new. A refresh of either repository that changes
   a cited file opens a drift finding on the map through
   `flagStaleDeliverables` (`src/kernel/drift/deliverables.ts`), because the
   map's evidence names items in both sources.

Edges live in the deliverable with their evidence, not as graph relations,
because `relations` has no evidence column and giving it one would alter an
existing table. When the graph needs them, they enter as `depends_on` or
`feeds` relations with basis observed (proposed until a person confirms
them) between the two `system` entities. A relation cannot name the
deliverable that cites it (no column holds that), so the deliverable stays
where an edge's evidence is read. A new validator, `edges_cited_both_ends`
in `src/kernel/workflow/validators.ts`, checks rules 1 and 2. No workflow is
dedicated to system maps today; the validator goes on the steps of
`architecture-decision-review` and `rfc-authoring` that run the
system-architecture skill, whose step 2 (compare the stated boundaries with
the code's imports) is where edges are drawn.

## 5. What each host can open

Two questions per host: can its own tools read a sibling folder outside the
project, and can it read a GitHub repository that is not cloned. Every row
cites the host's own documentation, accessed 2026-10-08.

| Host | Sibling folders on this machine | A GitHub repository with no clone |
|---|---|---|
| Claude Code | `--add-dir <path>` at startup, `/add-dir` during a session, `permissions.additionalDirectories` in a settings file. Files there become readable without prompts and edits follow the permission mode; a settings-file entry grants file access only and loads none of that folder's configuration. `.claude/settings.local.json` entries apply without the workspace-trust step unless the file is tracked in git. [1] [2] The settings reference's own `additionalDirectories` example is a relative path, `"../docs/"` [2]; what a relative entry resolves against is not stated there (unverified). | GitHub's remote MCP server: `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` with a token header, or a claude.ai connector when signed in with a claude.ai account. [3] |
| Cursor | Since 3.2 (2026-04-24) "a single agent session can now target a reusable workspace made of multiple folders". [4] That the workspace is a VS Code `.code-workspace` file, and how the agent treats files outside its folders: unverified. | MCP servers in `.cursor/mcp.json` or `~/.cursor/mcp.json`, local or remote over HTTP. [5] GitHub's MCP server ships a Cursor install guide. [6] Cursor's GitHub integration lets cloud agents "clone your code and create working branches" [7]; whether one cloud agent spans several repositories: unverified. |
| Codex | `--add-dir` grants "additional directories write access alongside the main workspace"; `sandbox_workspace_write.writable_roots` adds writable roots under `workspace-write`. [8] [9] Both grant write, more than reading needs. What Codex may read outside the workspace: unverified (the sandboxing page does not say). [10] | MCP servers under `mcp_servers` in the configuration file. [9] GitHub's MCP server ships a Codex install guide. [6] |
| OpenCode | The `external_directory` permission applies "when a tool touches paths outside the project working directory"; it defaults to ask and takes patterns that may start with `~` or `$HOME`. [11] Relative patterns: unverified. | MCP servers under `mcp` in `opencode.json`, local or remote. [12] GitHub's MCP server ships an OpenCode install guide. [6] |
| VS Code (GitHub Copilot) | Multi-root workspaces: a `.code-workspace` file lists folders by absolute or relative path, and "relative paths are better when you want to share Workspace files". [13] Whether Copilot's agent reads every root: unverified. | `#githubRepo` searches `owner/repo` for "a codebase that is not open locally". [14] GitHub's MCP server installs in one step for VS Code 1.101 and later. [6] |
| Bob (IBM Bob IDE) | Multi-root workspaces exist: release 2.0.2 (August 2026) makes the active task workspace follow the file being edited. [15] How Bob reads folders outside its workspace: unverified. | MCP servers in `.bob/mcp.json` (project) or `~/.bob/settings/mcp.json` (global). [16] Reading GitHub repositories: unverified; no Bob page found, and GitHub's MCP server lists no Bob guide. [6] Bob Shell: not checked. |

Three things follow for Construct:

- **Construct cannot learn the host's folders from the protocol, and should
  not start.** MCP roots, the protocol's way for a client to tell a server
  which folders it has open, are deprecated as of protocol version
  2026-07-28; new implementations "SHOULD NOT adopt it" and should pass
  directories "via tool parameters, resource URIs, or server
  configuration". [17] The binding in section 2.3 is that server-side
  configuration.
- **The host's model still has to open the files to quote them.** Construct's
  own reader runs in the MCP server process; whether each host runs MCP
  servers inside its own sandbox is unverified per host. The first slice
  only has `construct doctor` name, per host, how to give that host access
  to each bound checkout (the row above). Writing that access into each
  host's machine-local configuration is later work, done for all six hosts
  at once, because every host is a first-class host.
- **The GitHub path is the same everywhere.** Every host except Bob has a
  documented way to reach GitHub's MCP server, whose `get_file_contents`
  takes `owner`, `repo`, `path`, and a `ref` or a commit `sha`, and whose
  `--read-only` flag drops write tools. [6] That is enough for section 3's
  report on five of the six hosts.

## 6. Challenge

### 6.1 Strongest failure mode: witnessed, but the wrong tree

Concrete case. A developer's clone of payments sits at `../payments` on branch
`old-refunds` from March, with uncommitted edits. Production `main` renamed
the route to `/payments/charges` in June. A session draws the system map;
the edge "web calls POST /charges" cites
`payments:src/routes/charges.ts:12`, the excerpt matches the March file,
and the edge is drawn witnessed at both ends. Witnessed today means
"Construct opened it", not "it is the code the person means", so the map
is wrong with the strongest label Construct gives.

This is worse than a missing read, because a missing read is visible and
this is not. Controls, all in the design above:

1. Every read records commit, branch, commit time and uncommitted state, and
   the map's "drawn from" line shows them (section 4, rule 3).
2. The reader reads the committed tree, so uncommitted experiments never
   become evidence, and the summary says they were left out.
3. Identity is checked against the checkout's remotes, so a different
   repository at the hinted place is refused.
4. A GitHub address resolves only to the version recorded, so a citation of
   `main` does not borrow a local read of another branch (section 3.4).

What stays open: Construct cannot know, offline, that `old-refunds` is
behind `main` as it is now. The record makes it visible; it does not make
it impossible. Without fetching, the checkout's remote-tracking default
branch says what `main` was at the last fetch, and whether HEAD contains it
narrows the gap. That check is follow-up item 7 in section 8.

### 6.2 Read scope widening (the risk this work item carries)

A committed declaration naming a repository whose clone holds secrets
would, if reads were automatic, make Construct read it on every teammate's
machine. Controls: nothing is read until a person binds the checkout on
that machine; only tracked files at HEAD are read; private paths are
excluded with the same pattern delegation snapshots use; no session tool
can declare or bind a `git` source; `construct source show` prints the
binding (slice 2) and `construct doctor` lists every bound checkout
(slice 5). The existing gap, where a committed absolute `directory` source
outside the project is read with no per-machine step, is closed for new
declarations by slice 1, and `doctor` names the existing ones (slice 1).

### 6.3 Git run inside a repository Construct does not own

Running git in a foreign checkout can run that repository's configured
commands. Control: one hardened invocation, the one the delegation
workspace already uses, exported or moved to one shared place rather than
copied.

### 6.4 Best alternative not chosen: every other repository through the connector

Bind one project root and read every other repository through the host's
GitHub connector, as reported items. It needs no binding, no reader and no
read outside the project, it works the same in cloud agents, and it
composes directly with the evidence branch.

It was not chosen as the only path because provenance tops out at reported,
quotes past 16 KiB per file go unchecked, the host must report every file
it cites, nothing works offline, and the host's own GitHub tools differ per
host (Bob has none documented). It is kept as the fallback: any machine
without a binding reads this way, so the recommended design degrades to it
rather than failing.

Also rejected:

- **MCP roots**: deprecated by the protocol (section 5).
- **A mapping file**: the state store already holds per-machine facts out
  of git; a second format adds an ignore line to get wrong.
- **One Construct project per repository, joined through the related-project
  view**: that view (D2) answers a different question, what another
  project's store has recorded. It composes: a sibling that is itself a
  Construct project can be a `git` source here and a related project too,
  found through the same `relativePath`.

### 6.5 Load-bearing claims and how each was checked

| Claim | Checked by |
|---|---|
| Committed directory locators are absolute and relative ones are refused | Read `declaredFrom` and `directoryLocatorProblem` |
| The directory reader resolves against the working directory | Read `readDirectorySource` |
| `bootstrap` and `onSessionStart` ask `canRead` per source | Read the `bootstrap` definition in `src/kernel/broker/tools.ts` and `onSessionStart` in `src/hosts/hooks/handlers.ts` |
| A new required table means a new state format | Read the table check in `src/kernel/state/open.ts` and `REQUIRED_TABLES` in `src/kernel/state/schema.ts` |
| The evidence branch's declare, url and resolver behavior | Read the diff of `staging...5e104e34` (`feat/ti-evidence`), and checked that `cb93fc8e` still resolves any `https://` address |
| Repeat refreshes append a claim per item | Read `recordRead`, then ran three refreshes of a three-file directory source in a sterile store: 3, 6, 9 claims |
| Two sources holding the same path share one entity | Read `recordRead` and `findEntityByRef`, then refreshed two directory sources each holding `README.md` in a sterile store: one entity, two sources' claims on it |
| A rewrite of `sources.json` drops keys it does not know | Read the `add` and `remove` cases of `sourceCommand`, then ran `validateSourcesFile` on an entry carrying `relativePath`: the key is gone from the output |
| Host behavior | The sources in section 9, each opened on 2026-10-08 |

### 6.6 Verdict

**Accepted with controls.** The controls in 6.1 to 6.3 are part of the
slices, not follow-ups. Should this be Construct's job at all? Yes: the
host reads, and Construct's job is knowing what was read, at which version,
and whether a citation names it. A second repository is more of the same
job.

## 7. Recommendation: the smallest changes to existing functions

### Before slice 2: a refresh records each item once, under its own source

`recordRead` in `createSourceService`: write a claim only for an item that
is new or whose fingerprint moved, moving its earlier claim to superseded
(a status claims already have), and find or add each artifact entity under
`<sourceId>:<ref>`, the form `aliasRef` already uses, instead of the bare
ref. This is follow-up item 5 in section 8.

### Slice 1: in-project directories become portable

1. `declaredFrom` in `src/cli/source.ts`: commit a directory inside the root
   as a path relative to it. Refuse a committed directory outside the root,
   naming `--kind=git` and `--local`. `--local` keeps an absolute path.
2. `directoryLocatorProblem` in `src/kernel/source/locators.ts`: accept a
   relative path that does not climb, as well as an absolute one.
3. `refresh` and `peek` in `createSourceService`
   (`src/kernel/source/service.ts`): resolve a relative directory locator
   against `deps.root` before calling the reader. Without a root, the source
   is unreachable and says why.
4. `readDirectorySource` in `src/hosts/sources/directory.ts`: refuse a
   relative locator instead of resolving it against the working directory.

`createEvidenceResolver` needs no change. Existing absolute locators inside
the root keep working. `construct doctor` names each committed absolute
directory locator: one inside the root would be portable as relative, and
one outside it is a candidate for a `git` source.

### Slice 2: sibling repositories, witnessed when bound

1. `src/kernel/source/locators.ts`: a new pure `repositoryIdentity(kind,
   locator)`, and `gitLocatorProblem` refuses a locator with no identity.
2. `validateSourcesFile` in `src/kernel/project/sources-file.ts`: an
   optional `relativePath` on `git` sources only.
3. `SourceReader` in `src/kernel/source/connector.ts`: an optional
   `checkout` in its input.
4. A new `readGitCheckout` in `src/hosts/sources/git.ts`, registered in
   `hostReaders` (`src/hosts/sources/readers.ts`). It takes the hardened git
   invocation and the private-path pattern from
   `src/hosts/delegation/workspace.ts`, exported or moved, not copied.
5. `createSourceService`: `canRead(id)` is true for a `git` source only when
   it is bound and verified; `reportRead` refuses only when `canRead(id)`;
   `refresh` and `peek` pass the checkout; new `bindCheckout` and
   `unbindCheckout` record `source.checkout` observations after the remote
   check, which lives in the hosts layer and is injected the way readers
   are.
6. `SOURCE_SPECS` and `sourceCommand` in `src/cli/source.ts`: `source bind`
   and `source unbind`; `source show` prints the binding, revision, branch
   and uncommitted state.
7. `projectResolver` in `src/kernel/source/resolver.ts` passes the checkout
   and the read's revision; `createEvidenceResolver` resolves `<id>:<path>`
   for a bound `git` source like a directory source rooted at the checkout,
   limited to items the read recorded, with text only when the file's blob
   id matches.
8. `bootstrap` and `onSessionStart` need no change: an unbound `git` source
   lands in `reportWhenRead`, a bound one in `changedSinceRead`.

### Slice 3: connector reads meet the same source (after the evidence branch merges)

1. The `sources` definition's `validate` in `src/kernel/broker/tools.ts`:
   accept `fingerprint` on report items.
2. The evidence branch's `declare` action in the same file: refuse a
   `github` declaration whose identity matches an active source, naming it.
3. `forgeFileOf` in `src/kernel/project/urls.ts` and its use in the address
   branch of `createEvidenceResolver`.

### Slice 4: architecture maps cite both ends

`edges_cited_both_ends` in `src/kernel/workflow/validators.ts`, the edge
shape in section 4, and the system-architecture skill's steps naming it.

### Slice 5: host access, for all six hosts at once

`construct doctor` names, per host, how to give that host access to each
bound checkout. Writing it into each host's machine-local configuration
comes after, for every host in the same change.

## 8. Follow-up work for the ledger

Each item belongs under the parent outcome for this program.

1. **In-project directory sources commit a relative path.** Acceptance:
   `construct source add docs --kind=directory --locator=./docs` writes
   `"locator": "docs"`; a refresh from any working directory reads the
   project's `docs`; a committed directory outside the root is refused with
   the remedy; existing absolute in-root locators still read; `construct
   doctor` names each committed absolute directory locator. Risk: a
   project whose committed absolute path pointed outside the root on
   purpose loses the ability to add another one that way; `--local` and
   slice 2 cover it.
2. **Sibling repositories as `git` sources, bound per machine.** Acceptance:
   a committed `git` source with `relativePath` reads nothing until
   `construct source bind`; a folder whose remotes do not match is refused
   with the remotes listed; a bound read records commit, branch and
   uncommitted state, lists tracked files only, leaves private paths out,
   and resolves `payments:<path>` as witnessed; an unbound source accepts
   host reports and shows in `reportWhenRead`; `construct source add` and
   `remove` keep `relativePath` on the entries they rewrite; no state
   format change.
   Risk: read scope widens beyond the project; git runs in a repository
   Construct does not own.
3. **GitHub addresses resolve to the recorded version** (after the evidence
   branch merges). Acceptance: a permanent link at the recorded commit
   resolves to the item; `blob/main/...` resolves only when the read
   recorded `main`; another commit does not resolve under `require`; report
   items accept `fingerprint`; `declare` refuses a duplicate identity.
   Risk: a citation the person expects to pass is refused because the host
   read a different ref than it cited.
4. **Architecture maps cite both ends of each edge.** Acceptance: a map
   whose edge cites only one end fails `edges_cited_both_ends` unless the
   edge is labeled inferred with a reason; the map names the revision of
   each source it drew from. Risk: maps of systems without code access
   (a vendor API) carry many inferred edges; the label must stay readable.
5. **A refresh records each item once, under its own source.**
   Acceptance: refreshing an unchanged directory source twice leaves the
   claim count where the first read put it; a changed item supersedes its
   earlier claim instead of adding beside it; two sources that both hold
   `README.md` record two artifact entities, each with only its own
   source's claims; existing stores keep their rows. Risk: code that counts
   claims as a read history loses that history, and an existing store keeps
   an entity under the bare path beside the new source-qualified one. This
   blocks item 2.
6. **Host access to bound checkouts, all six hosts.** Acceptance:
   `construct doctor` names, per host, how to give it access to each bound
   checkout, and the unverified cells in section 5 are checked live first.
   Risk: host documentation moves; the rows cite their sources and dates.
7. **A bound read says when it is not the default branch.** Acceptance:
   without fetching, a bound read records the remote's default branch as
   last fetched (the remote-tracking `HEAD`) and whether the checkout's
   HEAD contains it; the map's "drawn from" line and `construct source show`
   say "not the default branch as last fetched" when it does not, and say
   the default branch was not checked when there is no remote-tracking
   default. Risk: a checkout fetched long ago compares against an old
   default branch, so the label understates how stale it is; the wording
   has to say "as last fetched".

## 9. Sources (each opened 2026-10-08)

1. Claude Code, Configure permissions, "Working directories" and
   "Additional directories grant file access, not configuration":
   https://code.claude.com/docs/en/permissions
2. Claude Code, settings reference, `permissions.additionalDirectories`:
   https://code.claude.com/docs/en/settings-reference
3. Claude Code, MCP: https://code.claude.com/docs/en/mcp
4. Cursor changelog 3.2, "Multitask, Worktrees, and Multi-root Workspaces"
   (Apr 24, 2026): https://cursor.com/changelog/04-24-26
5. Cursor, MCP: https://cursor.com/docs/context/mcp
6. GitHub MCP server README (tools `get_file_contents`, `get_repository_tree`,
   `list_commits`; `--read-only`; installation guides per host):
   https://github.com/github/github-mcp-server
7. Cursor, GitHub integration: https://cursor.com/docs/integrations/github
8. Codex CLI reference (developers.openai.com/codex/cli/reference redirects
   here): https://learn.chatgpt.com/docs/developer-commands?surface=cli
9. Codex configuration reference (developers.openai.com/codex/config-reference
   redirects here): https://learn.chatgpt.com/docs/config-file/config-reference
10. Codex sandboxing: https://learn.chatgpt.com/docs/sandboxing
11. OpenCode, permissions, `external_directory`:
    https://opencode.ai/docs/permissions
12. OpenCode, MCP servers: https://opencode.ai/docs/mcp-servers
13. VS Code, multi-root workspaces:
    https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
14. VS Code, how Copilot understands your workspace (`#githubRepo`):
    https://code.visualstudio.com/docs/agents/reference/workspace-context
15. IBM Bob IDE changelog: https://bob.ibm.com/docs/ide/changelog
16. IBM Bob IDE, MCP in Bob:
    https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
17. Model Context Protocol, Roots (protocol version 2026-07-28, deprecated):
    https://modelcontextprotocol.io/specification/2026-07-28/client/roots
18. GitHub REST API, repository contents (blob `sha`, 1 MB content limit):
    https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28
19. GitHub Docs, getting permanent links to files:
    https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files
20. Pro Git, Git objects (how a blob id is computed):
    https://git-scm.com/book/en/v2/Git-Internals-Git-Objects

## 10. Unverified, to check before relying on it

- What a relative `additionalDirectories` entry in Claude Code resolves
  against (the documented example is `../docs/`).
- Whether Cursor's multi-folder workspace is a `.code-workspace` file, and
  how Cursor's agent treats files outside its folders.
- Whether one Cursor cloud agent can work across several repositories.
- What Codex may read outside its workspace under each sandbox mode.
- Whether OpenCode's `external_directory` takes relative patterns.
- Whether GitHub Copilot's agent in VS Code reads every root of a
  multi-root workspace.
- How Bob reads folders outside its workspace, and whether Bob has any
  documented way to read a GitHub repository; Bob Shell was not checked.
- Whether the GitHub MCP server's `get_file_contents` returns the blob sha
  to the model, and the GitHub connector tool names on each host.
- Whether each host runs MCP servers inside its own sandbox.
- Whether GitHub matches owner and repository names without regard to case.
