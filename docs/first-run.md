# Your first run

You talk. Staff shows up. That is first run.

You are already in a session that can call tools — Cursor, Claude Code,
Codex, OpenCode, or IBM Bob. No catalog words. No `--host`. Point that
session at Construct:

```bash
construct serve
```

Then say what you are looking at. "Is this ready." "Do the claims match."
"What is the product shape." The session calls `record_outcome` with the
domains that question implicates. Tasks queue under those names. The same
session pulls the next one with `claim_task` and writes the finding back
with `submit_work`. You never leave the conversation to type a verb.
Construct will not spawn a second CLI.

The methods in play are investigative-research, decision-framing, and
intake — how the work is done, not job-title seats.

## When the call is yours

The only Construct-shaped surface is an inbox card, and only when the
decision is actually yours: what happened, what you decide, one action.

```
decision inbox (1):

  dec-…  Should the public claim stay up?

      evidence-provenance: hold [deliverable:…]
      coverage-gaps: challenge [deliverable:…]

Resolve with: construct decide <id> "<your call>"
```

An empty inbox is a real answer: nothing needs you right now. Everything
else stays in the conversation you are already having.

## This session can dispatch

The surface can dispatch work. When a secret is set, `claim_task` and
`submit_work` are on the same socket: the session that just named the
outcome is the session that pulls the next task. Product `serve` creates
that secret. Construct does not spawn a second agent to do the work.

What stays off the socket is `promote`, `review`, `compose`, a CLI `ask`,
and erasure — human-gated or destructive.

The keyword map is the zero-model fallback for a plain terminal with no
host wrapping the command — it is not first-run. The terminal command
list lives in [cli-walkthrough.md](cli-walkthrough.md). Construct never
ships its own agent runtime.
