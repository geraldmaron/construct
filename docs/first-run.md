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
