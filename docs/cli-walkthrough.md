# Terminal walkthrough

First-run is talk in the host you already have after `construct init`
([first-run.md](first-run.md)). This page is the CLI reference for a
plain terminal. It is not first-run. Hostless keyword staffing is not a
product success path.

## Install, then initialize

```bash
npm install -g @geraldmaron/construct@alpha
construct init
```

That creates project-local Construct config and format-v1 state under
`.construct/` (runtime state is gitignored). Preview with
`construct init --dry-run`. If an unsupported alpha store is already at the
project path, run `construct reset --yes` instead of expecting a migration.

Native host MCP and operational-skill reconcile is part of init's job for
supported clients. `construct init` plants the short operational `construct`
skill into the ambient (or `--client`) host skills directory and reconciles
session-bound MCP where an adapter exists. Bob and Codex may still need a
manual `construct serve --client=… --project=…` entry — fallback wiring, not
the product door.

You need Node 22.18 or newer. `construct doctor` is recovery and a health
check, not onboarding. It reports Node, the store, which hosts are present
(found, version, spawnable, auth), and skill-pack skew when a generated lens
pack is present. Inside a host, an `ambient` line names in-session dispatch
through MCP. Only Node and store checks gate the exit code. The full check
table is in [consumer-install.md](consumer-install.md).

The rest of this page is the terminal walkthrough — every command below is a
real verb. Interactive control stays on MCP after init; headless `work` is
the operator claim/submit path, not ambient host spawn.

## Record an outcome (terminal)

Say what you want to happen, in your own words. Not a task, not a role, not a
prompt: the thing you want to be true.

Product staffing on the terminal needs `--domains=…` and/or `--host=…` (or
you are already in a host session and use MCP). A hostless
`construct outcome` without those refuses with exit 2 — keyword routing is
not a product staffing path. Inside an ambient host session, the same command
without `--domains` creates no run and does not consult the keyword map;
this session infers via MCP (`start_run` / `next_work`).

Name the concerns yourself when you already know them:

```bash
construct outcome --domains=employment,contracts "We want to hire a contractor in Poland"
```

A named-domain capture prints roughly:

```
run run-…
  outcome: We want to hire a contractor in Poland

implicated domains (1):
  employment  — people you engage and how you engage them
      reason: named by the user

You named these; nothing was inferred and no model was consulted.

filed 2 work log entries and queued 1 task(s).
Interactive: next_work / submit_work in the host session (MCP).
Headless:   construct work claim --pin=<executor>  (requires construct init)
Read back:  construct log --run run-…

plan plan-run-…: 1 step, risk high, no sources declared
  construct plan run-…
```

The plan lines point at the run's recorded plan. Reading it shows which
concern each step is routed to, on what evidence, and what the deliverable
owes. `construct plan` takes the run id as a plain word, not a flag.

Or let a host model read the sentence and name the staff. Pick whichever
`construct doctor` shows you have (`opencode`, `claude`, `codex`, or
`cursor`); the examples below use `<your host>`:

```bash
construct outcome --host=<your host> "We want to hire a contractor in Poland"
```

Then each domain cites a stated reason from the model. Naming a domain nobody
defined is an error that lists the catalog rather than inventing a role, and
the record shows your choice as your choice rather than as something the
system inferred.

The keyword map remains for measurement and fallback history only. It is not
first-run and not the product inferrer.

## Run the work

Without project init, `construct work` refuses and points at init / MCP:

```bash
construct work
# → requires an initialized project (`construct init`)
#   Interactive work is MCP next_work / submit_work in the host session.
```

With init, `work` is the headless operator path — claim, submit, status —
not interactive control and not ambient home-store spawn of host CLIs:

```bash
construct work claim --pin=<executor> [--run=<id>]
construct work submit --pin=<executor> --task=<id> --token=<n> --deliverable='…'
construct work status [--run=<id>]
```

Interactive dispatch stays on MCP `next_work` / `submit_work` in the host
session that already has Construct wired. Construct keeps the log and the
inbox. In-session dispatch spends the host's own already-present capacity;
Construct does not start a second paid run for that path.

## Read the deliverable

```bash
construct show --run=<your-run-id>
```

This is the work itself: each role's deliverable in full, with its promotion
state and, where the domain calls for it, the licensed-review qualifier on the
same screen as the text it qualifies. A deliverable you cannot read is not a
deliverable, so this command exists.

## Ask a question instead

Not everything you want from a team is a piece of work. Sometimes you want to
turn to whoever owns a thing and ask them:

```bash
construct ask --host=<your host> "what does our roadmap say about the billing migration"
```

This is the same spine — the same catalog choosing who answers, the same
declared sources read before the dispatch, the same work log, the same citation
check — with one concern answering instead of every concern that was touched,
and the answer printed here rather than left for `construct show`. It is one
concern's dispatch, not four.

You still never type a role name. If the question touches concerns beyond the
one answering, they are named on screen so you can see what a full run would
have added, and told how to get it. If it lands somewhere this tool rates high
risk — privacy, contracts, employment, compliance — it says so before it
answers, because one grounded pass is not a review and an answer shaped like an
answer invites more trust than it has earned.

Without `--host` (and not in-session), `ask` refuses with exit 2. Keyword
routing is not a product staffing path.

## Tell it what you work from

Construct can hold what your project works from — a directory of docs, a git
repo, a GitHub or Jira project — so future runs can be held to what they
actually read:

```bash
construct source add --kind=directory --locator=./docs
construct source add --kind=git --locator=/path/to/your/repo
construct source list
```

Declaring a source builds no connection and reads nothing by itself. When
work runs — in-session via MCP, or headless via `construct work claim` on an
initialized project — local ground (a directory, a git checkout) is surveyed
first: the run records which documents it found and how completely, the roles
receive them by name, and they may read further inside those roots and cite
what they read by path. A document the walk cannot read as text — a PDF, a
deck — is put into words through the extraction ladder if a rung on this
machine can, and recorded with the reason if none can. A remote source
(`jira`, `github`, `docs`) is recorded as unreachable until a host can reach
it — adapter code under `src/connectors/` exists, but no shipped path
constructs a live Construct transport yet, so remotes stay unreachable from
Construct itself. Prefer vendor MCP in the host, or supply `--live=` files
where the CLI asks for them. An unreachable remote is an answer, not an
omission.

Point the project at the ground you mean. Declared roots that sit outside the
directory roles will work in are refused, because a role dispatched somewhere
else cannot open the material it is about to be graded on — and the failure is
silent from the inside, arriving as a finished deliverable with nothing behind
it. Bind ground with `construct source add` (and `--workspace=` when you need
more than one), then drive work in-session or with headless `work claim`
`--pin=` on that initialized project.

```bash
construct source add --kind=git --locator=/path/to/repo --emphasis=code --cap=200
```

A locator says where context lives and nothing about how far to trust it, so a
wish list and the agreement everything is measured against arrive at a role as
the same kind of thing. Say what a source is, in your own words:

```bash
construct source describe --id=<source-id> --authority=aspirational --relevance="the 2027 wish list, not the plan we funded"
construct source add --kind=directory --locator=./contracts --authority=source-of-truth --sensitive
```

The tiers are `source-of-truth` (what it says is the record), `working` (in
progress, true about where things stand), `aspirational` (what somebody wants
to be true) and `archive` (kept for history). Whatever you say travels: roles
are told it before they read, and a citation into a described source carries
its tier where a reader sees it, so a memo resting on an aspirational plan
reads as one. `--sensitive` adds that what the source holds does not travel —
and standing consent for low-risk outward writes stops covering it, so a change
against that source waits for you. Nothing writes a description except this
command; a tier you did not type does not exist.

The label beside a citation is the source's description as it stands now, not
as it stood when the deliverable was written. Re-describe a source and every
deliverable citing it reads differently the next time you open it, which is the
point: demote a plan to aspirational and the work resting on it should stop
looking settled. What the roles were actually told at dispatch is kept in the
work log (`construct log --run=<id>`), so the history is still there.

A description says what one source is. Say how two of them stand to each other
and Construct starts reading the pair:

```bash
construct source relate --from=<source-id> --to=<source-id> --as=governs --note="the strategy sets what the repo is held to"
construct source relations
construct source unrelate --id=<relationship-id>
```

The words are `governs`, `depends-on`, `feeds`, `supersedes`,
`covers-same-initiative` and `contradicts`, and each one changes something. A
run with several roles divides its ground along them: sources that govern,
feed, depend on or contradict each other always reach the same role together,
sources you said cover one initiative are spread across different roles so
nobody pays twice for one view, and a source something supersedes is kept out
of any dispatch carrying its replacement. Roles are told the relationships in
your own words, and a finding resting on both sides of one has to say which
boundary it crossed.

Watches read them too. Put a watch on both ends of a relationship and a sweep
that sees one side move while the other stands still raises that as its own
decision, naming the relationship it came from — which is the difference
between "a file changed" and "the plan no longer follows the strategy it is
held to".

A model can propose a relationship it noticed, and a proposal is all it ever
is until you decide. Outward and source-relationship proposals still use the
legacy `decide` verb for approve / reject / apply; typed inbox decisions
prefer `construct inbox` / `construct inbox decide`:

```bash
construct propose relation --from=<source-id> --to=<source-id> --as=supersedes --because="the newer plan names the older one as replaced"
construct decide --approve=<proposal-id> "<why>"
construct decide --apply=<proposal-id>
```

(`decide --approve` / `--apply` remain the proposal verbs; judgment inbox
cards use `construct inbox decide`. Prefer the surface that matches the
artifact.)

Standing consent never covers one of these, whatever else it covers: a
relationship reshapes what every later run is assembled from, so it waits for
you. Applying needs no host — the change lands in your own store, not in
anyone else's system.

Once ground is declared, you can ask what disagrees inside it without waiting
for a run to notice:

```bash
construct review --host=<your host>
```

That surveys every declared source, reads the documents for contradictions,
and reports only what cites both sides by documents the survey actually found.
It writes nothing.

There is also an engagement mode:

```bash
construct mode --set=seat
```

`team` (the default) means Construct is the whole team. `seat` means it fills
one role on your human team and treats your tracker as the system of record —
changes to it are proposed to you, never just made. A proposal you approve can
then be carried out through a host, which records only what that host reported
succeeding:

```bash
construct decide --apply=<proposal-id> --host=<your host>
```

Carrying a change out needs a host that can write, which is `opencode` or
`claude`. `codex` and `cursor` dispatch read-only and are refused here. A host
with no way to reach the system says so, and the change stays yours to make
rather than being recorded as made.

## Keep facts about the people you work with

A durable operating fact ("this client decides scope by quarter") belongs to
the workspace. A fact about a named subject ("Acme moved its renewal to Q3")
belongs to that subject:

```bash
construct record add --kind=customer --name=Acme
construct notes ./calls --host=<your host>
construct record show <record-id>
```

`construct notes` takes a file or a whole directory, ingesting each document
as its own note. Record fields fill in from those notes and are never set by
hand: every value carries the note line that taught it, and the value before
it survives, so `construct record show <id> --field=renewal` shows how it got
there. A note only reaches the records it names, so a note that says "they
moved the renewal" without naming anyone updates nothing — which is the
correct answer, not a missed one.

### When someone asks to be forgotten

Records and notes hold facts about named people and organizations, which is
what an erasure request is about. Every other table here is append-only and
stays that way; these two can be erased, and only by erasing:

```bash
construct record erase <record-id> --reason="the customer asked to be forgotten"
```

That removes the subject and every value its fields ever held, including the
earlier ones. What survives is a line saying an erasure happened, with a count
and your reason and no content of its own.

It then lists the notes that still say that name, and does not touch them. A
note naming two subjects is evidence about both, so taking it for one would
destroy the other's record with nobody having asked. Read one before you erase
it:

```bash
construct record erase-note <note-id> --reason="only about the erased subject"
```

Erasing a note means anything that cited a line of it stops resolving. That is
correct: a fact justified by words that no longer exist should not go on
presenting itself as justified.

### One workspace, or one per client?

Records hold several subjects inside one workspace, so a client engagement
with its vendors and stakeholders is one workspace with several records. What
does *not* divide by record is the ground: declared sources, the engagement
mode, and workspace memory are all workspace-wide, so every run in a workspace
is grounded in every source declared there.

Use a workspace per client engagement whenever their material may not mix.
Records inside one shared workspace are for subjects that may legitimately see
each other's documents — your own vendors, your own programmes, a single
client's org chart. The cost of getting it wrong runs both ways: sharing when
you should not have puts one client's documents in the survey grounding
another's work, and splitting when you need not have splits the operating
memory you paid to learn.

Sources and the engagement mode both belong to a workspace, and every command
that touches one takes `--workspace=<name>` — including `construct outcome`.
That is how a run is pointed at a different ground without disturbing the one
other runs were read against:

```bash
construct source add --kind=directory --locator=./docs/adr --workspace=architecture
construct outcome --workspace=architecture "Decide whether the adapter seam absorbs retry state"
```

Everything defaults to a workspace called `default`, so you can ignore this
until you need two grounds at once. The plan line names the workspace whenever
it is not the default one.

## Get one document out of several

A run that implicates three concerns dispatches three roles and returns three
deliverables. Each answers its own concern and each is right to decline the
rest, which leaves the composing to you:

```bash
construct compose --run=<id> --host=<your host>
```

The composer may arrange what the roles established and may not add to it.
Every claim names the deliverable it came from; a claim attributed to a role
that produced nothing is refused outright, and each role is then shown its own
work beside the claims drawn from it and asked which it does not support. What
fails either check is removed, not footnoted.

The last section is the one to read first. `what nobody answered` lists the
parts of your outcome no deliverable covered — a composition that quietly
answers two thirds of what you asked is the failure composing introduces, and
naming the gap is the whole defence against it.

## Turn the findings into changes somebody can decide on

A finished document ends with numbered issues and a section saying what follows
from them, and acting on it usually means retyping each item into whatever
system the work actually lives in. The retyping is where the citation is lost.

```bash
construct propose --run=<id> --source=<source-id>
```

Each numbered issue and each what-follows item becomes one write proposal
against a source you declared, carrying the citation of the finding behind it —
`deliverable:<task>#L<n>`, resolvable to the line it was read from. No model
call, so it is free and re-runnable; the same finding proposes the same row
twice rather than a second copy of it.

The tier follows the action, not the confidence. Commenting and labelling are
low; creating and updating are high, and high never applies on standing consent.
A finding whose words ask for nothing becomes a comment recording it, never a
change guessed at from a report. Add `--dry-run` to see the rows without filing
them, and `construct propose list` to read what is waiting.

Nothing here is written outward. A proposal is a row waiting on a decision;
carrying one out is a separate, recorded step.

## Read back what happened

```bash
construct log --run=<your-run-id>
```

The work log is append-only and every line is in a role's name. It records what
was inferred and why, what was dispatched to which model, and what came back.
Nothing edits it, including Construct.

```bash
construct inbox
```

The inbox holds decisions that are genuinely yours to make, which usually means
two roles disagreed and neither should win by default. An empty inbox is a real
answer and says so.

```bash
construct inbox decide <id> "<your call>"
```

When you resolve a decision that way, Construct may distill it into a held
run-derived lesson. Those never auto-admit — familiarity with the system's own
operation is not verification. List and admit them on the spine:

```bash
construct lessons --workspace=<name>
construct lessons --admit=<lesson-id> --by=<you>
```

Listing takes no subcommand: a bare `construct lessons` prints the workspace's
held and admitted lessons in two groups. `--by=` names the human approving and
is required; admitting without it exits 2, and an unknown lesson id exits 1.
Admitted lessons enter the operational brief that `work` and `ask` already
inject; hosts do not get an admit surface.

## Tell it whether it was right

This is the part most tools skip, and it is the part that makes the next run
better:

```bash
construct verdict --run=<your-run-id>
```

That lists what surfaced. Then say what you actually think:

```bash
construct verdict --run=<your-run-id> --confirm=employment --dismiss=contracts
```

`--confirm` means it was right to raise this. `--dismiss` means it was not.
`--missed=<domain>` is for the one that should have come up and never did,
which is the most valuable thing you can tell us, because a system cannot
notice its own silence.

## The other way in: your own agent host

If you already work inside Claude Code, Codex, Cursor, VS Code agent mode, or
OpenCode, you do not have to learn this CLI as first-run. Run
`construct init --client=…` so format-v1 state, the operational skill, and the
`construct serve` MCP entry are written for you. OpenCode, Claude Code,
Cursor, and VS Code are covered; Bob and Codex stay manual fallback. A host
with its own MCP-add helper takes the same entry in a line — Claude Code, for
example:

```bash
claude mcp add construct -- node "$(which construct 2>/dev/null || echo construct)" serve --client=claude-code --project="$(pwd)"
```

Or, for any host that reads a config file, write the entry yourself — bind
`--client` and `--project` so the session identity is structural, not guessed:

```json
{
  "mcpServers": {
    "construct": {
      "command": "construct",
      "args": ["serve", "--client=claude-code", "--project=/absolute/path/to/repo"]
    }
  }
}
```

Then talk to your host normally. After `construct init`, the interactive plane
exposes `start_run`, `next_work`, `submit_work`, inbox/decide, staff, and
routines — the session that holds the conversation is the session that pulls
the next task. Construct does not spawn a second agent to do that work. What
stays off the socket is destructive or human-gated practice that belongs in
the terminal.

## When something is wrong

Friction is the point of this exercise, so please do not smooth over it. If a
step confused you, produced nothing, or produced something you did not believe,
that is a finding. Record the routing part as a verdict (above) so it lands in
the corpus, and tell whoever handed you this about the rest, in whatever words
you would have used to complain about it. Wording you found unclear is as real
a defect as a stack trace.
