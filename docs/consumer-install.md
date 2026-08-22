# Installing Construct into another repo

`docs/first-run.md` walks you through Construct against its own checkout.
This is the other case: you already have a working Construct checkout
somewhere on the machine, and you want a *different* repo — an app you're
building, not Construct itself — to have Construct present inside its agent
hosts. Every command below was run from inside two real app repos before
this file was published, verified with `construct doctor` run from inside
each. If a step behaves differently for you, that's the most useful thing
you can report back, same as first-run.md.

Nothing here builds or publishes Construct. It assumes a checkout already
exists and already passes its own gate.

## What actually gets installed

Less than you'd expect. Construct's state — the sqlite store, run history,
work log — resolves under your home directory
(`~/.local/share/construct`, `~/.local/state/construct`, XDG-overridable),
never inside the target repo. This build has no project-scoped config file
it reads or writes. The only thing the target repo gains is one MCP entry
telling its agent host where to find the `construct` binary.

(If you find a tracked `construct.config.json` in an older repo, that's a
v2 artifact — this build has no code path that looks for that filename.
Its presence or absence says nothing about whether this recipe worked.)

## Step 1: Point something at the checkout's bin/construct.mjs

Three ways to reach the CLI. Pick one.

**Direct invocation (recommended).** No PATH, no global install, nothing
that can drift from what the checkout actually contains:

```bash
node /path/to/your/construct/checkout/bin/construct.mjs doctor
```

This is what the MCP wiring in Step 2 already uses, so reaching for it in
your own shell too keeps one pattern instead of two.

**Global install (`construct` on PATH).** From the checkout:

```bash
npm install -g .
```

Convenient for typing `construct outcome …` directly, but it's a second
copy of the binary that can go stale after the checkout moves —
`docs/internal/host-interaction.md` records a real instance of PATH lagging behind a
release on this machine. Re-run `npm install -g .` after any change you
need reflected, or prefer direct invocation and skip the problem entirely.

**`npx` against the checkout path.** Works — verified against a real app
repo — but it goes through npm's own resolution machinery on every call,
which picks up noise from whatever the target repo's own npm/pnpm
configuration says (a `node-linker` warning surfaced this way in one of
the two apps this recipe was verified against, because that repo runs
pnpm). Use it only if the other two aren't available:

```bash
npx --yes /path/to/your/construct/checkout doctor
```

## Step 2: Wire the MCP entry

This is the part that actually changes something in the target repo. The
pattern already deployed in both apps this recipe was verified against is
one entry in `.cursor/mcp.json`, gitignored in both — this file is local
wiring, not something either app's policy commits:

```json
{
  "mcpServers": {
    "construct-mcp": {
      "command": "node",
      "args": [
        "/path/to/your/construct/checkout/bin/construct.mjs",
        "serve"
      ]
    }
  }
}
```

`construct serve` is the projection: presence inside whatever MCP host
reads this file. Per `docs/first-run.md`, it can read the catalog, record
an outcome, read the work log and where a run's tasks stand, show the
inbox and the questions roles have put to you, relay a decision or an
answer, record a verdict, drop a note, and read the workspace's subjects.
It can't dispatch work (spending your money stays behind a command you
type yourself), can't run `review` or `compose` for the same reason, can't
advance a deliverable toward finished, and can't erase anything. If
`.cursor/mcp.json` doesn't exist yet in the target repo, create it with
just this. If it exists with other servers already in it, add
`construct-mcp` as one more key under `mcpServers`.

For a host that isn't Cursor, `docs/first-run.md`'s "other way in" section
covers the same entry for Claude Code, Codex, and any host that reads a
plain MCP config file — the `command`/`args` pair is identical; only where
the host expects to find the file changes.

## Step 3: There is no init step

`construct outcome` (or any other first command) creates whatever state it
needs the moment it runs — a workspace named `default` if you don't name
one, the store itself if it doesn't exist yet. There is nothing to
provision first. `docs/first-run.md` covers that first real command; this
recipe stops at doctor because doctor is what proves the wiring, not the
workspace.

## Step 4: Verify with doctor

From inside the target repo — this matters, see the next section:

```bash
node /path/to/your/construct/checkout/bin/construct.mjs doctor
```

What each line means, and whether it can fail the exit code:

| check | what it means | gates the exit code |
|---|---|---|
| `node` | your Node meets the 22.18 floor | yes |
| `paths` | where state resolves to (home-scoped, not this repo) | no — always reports ok |
| `matrix` | which model families the tuning evidence covers | no — always reports ok |
| `store` | the sqlite store is writable | yes |
| `backup` | whether a copy of the store has ever been taken; an uninsured store is not a broken one | no |
| `host` (one line per host) | opencode/claude/codex/cursor found, version vs. the pin, auth state | no — report only |
| `litter` (if present) | predecessor-version markers found in *this* repo's tree | no — points at `construct cleanup --scope=project`, changes nothing itself |
| `skills` (if present) | a generated `.claude/skills` pack in *this* repo stamped by a different Construct version than the one running | no |
| `stale-draft` (if present) | settled deliverables still sitting at draft with no recorded verdict, past the threshold | no |

`doctor: healthy` and exit 0 means `node` and `store` passed — those are
the only two lines that can fail it. Everything else is information. A
missing host isn't a failure: presence-only use through the MCP entry
doesn't require one installed, and a host installed five minutes after
doctor runs is a normal sequence, not a bug doctor should have caught.

## The one rule that matters more than the others

**Every command above runs with its working directory inside the target
repo — never inside the Construct checkout, never inside a Construct
worktree.** `doctor`'s `litter` and `skills` checks read whichever repo
you're standing in, so running from the wrong place makes them report on
the wrong tree. Treat "`cd` into the target repo first" as the default for
every Construct command you run against a consumer app, not something to
remember case by case.

## Verified runs (2026-08-21)

Both ran clean, from inside each app's own repo, using the direct
invocation from Step 1 against this checkout:
`node /Users/geralddagher/Developer/Projects/construct/bin/construct.mjs doctor`.

These two transcripts are what those runs printed, not a promise that the
line set never grows. The table above is the list to read for what `doctor`
checks; a run of your own may carry lines these two do not.

**admin-app** (branch `main`):

```
ok   node  v24.19.0 (floor: 22.18)
ok   paths  state: /Users/geralddagher/.local/state/construct
ok   matrix  model matrix: tuned families claude (tuned 2026-08-05); every other family runs best-effort with degradation notes
ok   store  /Users/geralddagher/.local/share/construct/construct.db
ok   host  opencode: 1.15.4 (pinned: 1.15.4); auth: not probed — auth lives in the host's own config
ok   host  claude: 2.1.238 (Claude Code) (pinned: 2.1.216 (Claude Code)); auth: not probed — auth lives in the host's own config
ok   host  codex: codex-cli 0.145.0 (pinned: codex-cli 0.145.0); auth: Logged in using ChatGPT
ok   host  cursor: 2026.08.11-e8db854 (pinned: 2026.08.11-e8db854); auth: ✓ Logged in as geraldmdagher@outlook.com
doctor: healthy
```

**blackstory** (branch `staging`):

```
ok   node  v24.19.0 (floor: 22.18)
ok   paths  state: /Users/geralddagher/.local/state/construct
ok   matrix  model matrix: tuned families claude (tuned 2026-08-05); every other family runs best-effort with degradation notes
ok   store  /Users/geralddagher/.local/share/construct/construct.db
ok   host  opencode: 1.15.4 (pinned: 1.15.4); auth: not probed — auth lives in the host's own config
ok   host  claude: 2.1.238 (Claude Code) (pinned: 2.1.216 (Claude Code)); auth: not probed — auth lives in the host's own config
ok   host  codex: codex-cli 0.145.0 (pinned: codex-cli 0.145.0); auth: Logged in using ChatGPT
ok   host  cursor: 2026.08.11-e8db854 (pinned: 2026.08.11-e8db854); auth: ✓ Logged in as geraldmdagher@outlook.com
ok   litter  AGENTS.md and plan.md — run `construct cleanup --scope=project` to review
doctor: healthy
```

Neither run touched either repo: `git status` before and after is
identical in both, beyond dirty state that already existed there before
this recipe ran and that this recipe did not create. Neither run touched
the Construct checkout or a Construct worktree either — `doctor` never
opens the store for writing, so the only thing it does with the target
repo is read it.

## Known limitations

- `host` lines report a version drift for `claude`: the installed Claude
  Code is ahead of the version the adapter is pinned to. Doctor doesn't
  gate on this and nothing in this recipe changes it. The pin, and every
  behavior it was verified against, is `src/hosts/claude/pin.ts`; that
  file is what says which version the adapter actually stands behind.
- `opencode` and `claude` auth is never probed — neither offers a
  non-interactive status command, so "found" is the only signal doctor can
  give for those two. `codex` and `cursor` both get a real
  logged-in/not-logged-in answer.
- Doctor checks the parts Construct owns. It does not check that the MCP
  entry itself is well-formed or that the host has actually loaded it —
  confirming the host sees the tool is a restart-and-look step in whichever
  host you wired, not a `doctor` line.
- One of the two apps this recipe was verified against carries a tracked
  `construct.config.json` that predates this build's config model and
  isn't read by it. Flagged above so it doesn't get mistaken for live
  configuration by whoever reads this next.
