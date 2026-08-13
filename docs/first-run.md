# Your first run

This walks you from nothing to one finished outcome, and it should take about
ten minutes. Every command below was run as written before this file was
published; if one of them behaves differently for you, that difference is the
most useful thing you can report back.

Construct is an alpha. It works, and it is not finished. Two things are worth
knowing before you start. Recording an outcome is free and happens on your
machine, but actually running the work sends it to an agent host (OpenCode or
the Claude Agent SDK), and that costs whatever your host charges. Construct
never ships its own agent runtime, so a host has to be present for the second
half of this walkthrough.

## Install

```bash
npm install -g @geraldmaron/construct@alpha
```

You need Node 22.18 or newer. Then check that the parts Construct owns are
healthy:

```bash
construct doctor
```

You should see three `ok` lines and `doctor: healthy`. It checks Node, where
state lives, and whether the database is writable. It does not yet check
whether an agent host is reachable, which is a gap worth knowing about rather
than discovering later.

## Record an outcome

Say what you want to happen, in your own words. Not a task, not a role, not a
prompt: the thing you want to be true.

```bash
construct outcome "We want to hire a contractor in Poland"
```

Construct reads that sentence and works out which concerns it touches:

```
run run-20260805134446726
  outcome: We want to hire a contractor in Poland

implicated domains (2):
  employment  — people you engage and how you engage them
      signals: contractor, contractors, hire (score 30)
  contracts  — agreements with other parties and what they bind you to
      signals: contract (score 10)

filed 3 work log entries and queued 2 task(s).
```

Nobody typed "employment" or "contracts." That inference is the whole point:
the obvious concerns are obvious to a team that has done this before, and
Construct's job is to make them obvious to you. The `signals` line is the
evidence for each one, so you can disagree with it on sight.

That run happened without a model and without spending anything. If you would
rather have a model read your sentence instead of the keyword map, name a host:

```bash
construct outcome --host=claude "We want to hire a contractor in Poland"
```

Then each domain cites a stated reason rather than matched keywords, and the
output says which of the two you got. If you already know which concerns apply,
you can say so and skip inference entirely:

```bash
construct outcome --domains=employment,contracts "We want to hire a contractor in Poland"
```

Naming a domain nobody defined is an error that lists the catalog rather than
inventing a role, and the record shows your choice as your choice rather than
as something the system inferred.

## Run the work

```bash
construct work --run <your-run-id>
```

This is the step that costs money. Each implicated role gets its own
assignment, works the outcome from its own concern, and reports back. There is
a spend ceiling across every run on your machine (10 by default, in your host's
cost units), and hitting it stops dispatch rather than surprising you.

If your host is not installed or not authenticated, this is where you find out,
and the error says which it was.

## Read the deliverable

```bash
construct show --run <your-run-id>
```

This is the work itself: each role's deliverable in full, with its promotion
state and, where the domain calls for it, the licensed-review qualifier on the
same screen as the text it qualifies. A deliverable you cannot read is not a
deliverable, so this command exists.

## Ask a question instead

Not everything you want from a team is a piece of work. Sometimes you want to
turn to whoever owns a thing and ask them:

```bash
construct ask --host=claude "what does our roadmap say about the billing migration"
```

This is the same spine — the same catalog choosing who answers, the same
declared sources read before the dispatch, the same work log, the same citation
check — with one concern answering instead of every concern that was touched,
and the answer printed here rather than left for `construct show`. It is one
model call, not four.

You still never type a role name. If the question touches concerns beyond the
one answering, they are named on screen so you can see what a full run would
have added, and told how to get it. If it lands somewhere this tool rates high
risk — privacy, contracts, employment, compliance — it says so before it
answers, because one grounded pass is not a review and an answer shaped like an
answer invites more trust than it has earned.

Without `--host` the question is still recorded and routed, and nothing is
answered: reading a question costs a model call, and Construct does not spend
without being told to.

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
work runs, local ground (a directory, a git checkout) is surveyed first: the
run records which documents it found and how completely, the roles receive
them by name, and they may read further inside those roots and cite what they
read by path. A document the walk cannot read as text — a PDF, a deck — is
put into words through the extraction ladder if a rung on this machine can,
and recorded with the reason if none can. A remote source (`jira`, `github`,
`docs`) is recorded as unreachable until a host can reach it — an answer, not
an omission.

Dispatch where the ground is. A run is refused if a declared root sits outside
the directory its roles will run in, because a role dispatched somewhere else
cannot open the material it is about to be graded on — and the failure is
silent from the inside, arriving as a finished deliverable with nothing behind
it:

```bash
construct work --run <id> --host=claude --dir=/path/to/your/repo
```

By default the survey ranks prose ahead of code and lists forty documents,
which is right for understanding what a system promises and wrong for
understanding what it does. Say which you meant:

```bash
construct source add --kind=git --locator=/path/to/repo --emphasis=code --cap=200
```

Once ground is declared, you can ask what disagrees inside it without waiting
for a run to notice:

```bash
construct review --host=claude
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
construct decide --apply=<proposal-id> --host=claude
```

A host with no way to reach the system says so, and the change stays yours to
make rather than being recorded as made.

## Keep facts about the people you work with

A durable operating fact ("this client decides scope by quarter") belongs to
the workspace. A fact about a named subject ("Acme moved its renewal to Q3")
belongs to that subject:

```bash
construct record add --kind=customer --name=Acme
construct notes ./calls --host=claude
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

## Read back what happened

```bash
construct log --run <your-run-id>
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

## Tell it whether it was right

This is the part most tools skip, and it is the part that makes the next run
better:

```bash
construct verdict --run <your-run-id>
```

That lists what surfaced. Then say what you actually think:

```bash
construct verdict --run <your-run-id> --confirm=employment --dismiss=contracts
```

`--confirm` means it was right to raise this. `--dismiss` means it was not.
`--missed=<domain>` is for the one that should have come up and never did,
which is the most valuable thing you can tell us, because a system cannot
notice its own silence.

## The other way in: your own agent host

If you already work inside Claude Code, Codex, VS Code agent mode, or OpenCode,
you do not have to learn this CLI at all. Construct can appear inside the host
you already use:

```bash
claude mcp add construct construct serve
```

Or, for any host that reads a config file:

```json
{
  "mcpServers": {
    "construct": {
      "command": "construct",
      "args": ["serve"]
    }
  }
}
```

Then talk to your host normally. It can record an outcome, read the work log
and the inbox, relay a decision you made, and record a verdict. Because the
model in that host has already read your words, it can name the implicated
domains itself, and its proposals pass exactly the same gate a subprocess
model's would: a domain outside the catalog or without a stated reason is
discarded, and the reply says what was not admitted.

Two things are deliberately missing from that surface. It cannot dispatch work,
because spending your money stays behind a command you type yourself. And it
cannot advance a deliverable toward finished, because that judgment is not a
model's to make about its own output.

## When something is wrong

Friction is the point of this exercise, so please do not smooth over it. If a
step confused you, produced nothing, or produced something you did not believe,
that is a finding. Record the routing part as a verdict (above) so it lands in
the corpus, and tell whoever handed you this about the rest, in whatever words
you would have used to complain about it. Wording you found unclear is as real
a defect as a stack trace.
