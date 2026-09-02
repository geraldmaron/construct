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

Construct never switches hosts, spawns another agent, or spends through
another executor because one is installed. Work happens in the session you
are in. A headless runner exists only when you configure one, and it cannot
decide, grant, remember, or finalize anything.

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
