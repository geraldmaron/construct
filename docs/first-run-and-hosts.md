# First run and how the host behaves

Construct is installed once and used from the agent host you already work
in. Two minutes gets you a bound project and a session that knows it.

## Install and initialize

```bash
npm install -g @geraldmaron/construct@alpha
construct init --client=cursor --scale=solo --outcome="ship the first paying version" --constraint="never break the public API"
```

`init` finds the repository root, writes `.construct/` (project, constitution,
sources, and registry lock files, all committed) and one runtime database
under `.construct/state/` (ignored), reads what the project already says
about itself (README, agent instructions, architecture documents, ownership
files, the package manifest) and proposes a profile with provenance for each
proposal, plants the operational `construct` skill into the host's skills
directory, and writes the host's project MCP configuration so the host
launches `construct serve` bound to this project.

Without the answer flags, `init` leaves three questions open and the host
asks them in conversation: what this project is to you, what result matters
most now, and what Construct must be careful not to violate. Nothing
inferred becomes fact until you confirm it.

`--dry-run` says what would happen and writes nothing. `--no-wire` skips the
host configuration. `--skills-dir` plants the skill somewhere explicit.

## What the host does with it

When the host starts a session in this project it launches the server,
calls `bootstrap`, and receives a bounded summary: the project binding, how
complete setup is, open questions, source and registry health, what the
session may do, open decisions, active runs, and a recommended next action.
It does not receive skill bodies, source contents, or the whole context;
those are read one topic at a time when a step needs them.

The operational skill then teaches the session four kinds of request:

- **Answer.** A plain question gets a plain answer. Nothing is recorded.
- **Remember.** "Remember that we will not add schema migration until
  stable" records exactly one statement in your wording and nothing else.
- **Manage an outcome.** "Review this against our design principles"
  resolves a workflow, does each step in this session, validates the
  outputs, and hands back a finished deliverable with its evidence.
- **Maintain a standing outcome.** "Every month, review the governing
  documents against the implementation" defines a trigger an external clock
  fires; Construct keeps the ledger.

The host asks only when choosing the bigger kind would change cost,
persistence, permissions, or side effects and your words did not settle it.

## The host that is in front of you wins

Construct never switches the lead host or spends through another executor
because one is installed. [Bounded local delegation](bounded-delegation.md)
is opt-in and requires explicit executor/model configuration and matching
live permission evidence. All adapters are disabled by default. A headless
runner cannot decide, grant, remember, finalize, or recursively delegate.

## Several agents in one project

You can work in one project from several sessions at once, in the same host
or different ones, and a host can run several agents inside one session.
Construct keeps them from stepping on each other:

- Every session is recorded under an id Construct gives it, and what it does
  is recorded against that session, as the model acting, never as you.
- A work item is claimed before it is edited. A claim belongs to one session
  and one agent, returns a token only that claimant sees, and needs the token
  to renew, complete, or release it. Another session's claim is refused until
  it expires or that session goes quiet for two hours; taking it over records
  why.
- A claim can reserve the files or directories it will change. In one
  checkout, another claim cannot take a path someone holds exclusively; in
  another worktree the overlap comes back as a merge risk naming that
  checkout and branch, because each worktree has its own copy of the files.
  Reservations end with the claim, and are judged per work item: two agents
  a host cannot tell apart are still two writers. A reserved path is spelled
  plainly (no spaces, at most 512 bytes), so a file whose name has spaces is
  reserved through its directory. Taking over or accepting work releases any
  inherited reservation another claim already holds in the new checkout.
  `construct work check --paths=...` or
  `--staged` says what is reserved before you edit or commit, and exits 1 on
  a collision in this checkout.
- An agent that never calls Construct can still sweep a peer's file into a
  commit. `construct hooks install --git` adds a pre-commit guard that warns
  when a staged file is reserved by other work in the same checkout. It never
  blocks a commit, keeps any pre-commit hook you already had running after
  it, and `construct hooks uninstall --git` puts that hook back exactly.
  Set `CONSTRUCT_HOOKS=off` to silence it. When git's hooks live in a
  committed directory, Construct leaves them alone; add
  `construct work check --staged || true` there yourself.
- In Claude Code, `construct hooks install --host=claude-code` adds two hooks
  to the checkout's `.claude/settings.local.json`, which stays out of git: at
  session start the agent hears who else works here and what they hold, and
  right after it edits a file another agent holds in this checkout, it hears
  that too, even if it never called Construct. Neither hook can block
  anything; each always succeeds within a second and a half, says at most one
  short line of facts, and says nothing when anything is missing or broken.
  Hooks already in the file stay, and `construct hooks uninstall
  --host=claude-code` puts the file back as it was. Other hosts get a pack
  once one has been verified against them.
- Claimed work is passed on with a handoff: the holder offers it, with its
  token, and a packet saying where the work stands, what comes next, what to
  watch out for, and what is still open. Whoever accepts gets the claim, a new
  token, and its reservations in one step; nobody else can accept it after.
  A handoff never moves an approval. `construct work offers` lists what is
  waiting, and the packet is always shown as its author's words.
- Sessions learn about each other on the calls they already make. Bootstrap
  says how many other sessions are here, what they hold, and warns when one
  works in the same checkout. After that, a result carries
  `construct_peers` when another session or agent claimed, finished, handed
  off, or took over work since the last call: ids, holders, paths, and times,
  never anyone's notes. `construct status` lists the sessions present, and
  the `sessions` and `activity` topics of project context show the detail.
  Construct cannot interrupt a model mid-turn; a session that makes no calls
  hears nothing until it does.
- Git worktrees of the project share its one store in the main checkout, so
  an agent in a worktree sees the same work. `construct init` in a worktree is
  refused, because it would start a second store.
- Only you approve an action that leaves the project or destroys something,
  and only you accept or finalize a deliverable. A model relaying your words
  cannot. When the host can show you a question from Construct itself (MCP
  elicitation), Construct asks you there and waits a minute for your choice.
  Otherwise, or if you decline or close it, the question waits in
  `construct inbox` for you to answer from a terminal of your own. A host
  hook that could answer such questions for you (Claude Code's `Elicitation`
  or `ElicitationResult` hooks, in project, user, managed, or plugin
  settings) turns the prompt off, because its answer would not be yours.

## Checking that it is bound

```bash
construct status
construct doctor
```

`status` reads one state universe: setup completeness, work in flight,
decisions waiting on you, source health, registry lock, drift. `doctor`
never reports healthy for a missing or broken project, and it says what to
run next.

## Supported hosts

Claude Code, Cursor, VS Code, and OpenCode are wired by file (`.mcp.json`,
`.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`). Codex and IBM Bob
can receive the operational skill but read no project MCP file Construct
writes; point them at `construct serve --client=codex` or `--client=bob` by
hand. What was exercised against a real host is recorded in
[release-verification.md](release-verification.md); anything not listed
there is untested, not assumed.

## Hooks: habits that do not depend on the model

With `--client=claude-code`, init also adds three hooks to
`.claude/settings.json` (additively; other hooks are kept, and a settings
file that is not valid JSON is left alone). After each tool call,
`construct hook post-tool` records Jira issues a tool returned from a
declared project as a host read, so reporting reads is automatic. When the
host is about to stop, `construct hook stop` sends it back once if its reply
named project facts (a declared ticket key, a file, a source) without
`check_answer` or a gated step; `policy.answerCheck` set to off turns that
off. At session start, `construct hook session-start` adds a short note of
what waits. Every hook exits 0 and never blocks a session on its own
failure. `construct doctor` reports whether the hooks are installed, and
`construct status` shows over the last week how many answers were checked,
how many unchecked ones were caught, how many host reads were recorded, and
how many checks were waived.

Hosts without hooks still get the server-side floor: under
`policy.hostReads` set to require (the default), a citation into a source
only the host can read does not resolve until a read of that source has
been recorded.
