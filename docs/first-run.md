# Your first run

You talk. Staff shows up. That is first run.

You are already in a session that can call tools — Cursor, Claude Code,
Codex, OpenCode, or IBM Bob. Say what you are looking at, in ordinary
language. No catalog words. No `--host`. Point that session at Construct:

```bash
construct serve
```

The host infers. Construct does not classify intent, does not name
concerns, and does not route. There is no phrase table and no
Construct-side namer.

Two surfaces only:

1. Dispatch through this session. The host calls `record_outcome` with
   namings it chose, then `claim_task` / `submit_work`. You never leave
   the conversation to type a verb. Construct will not spawn a second
   CLI. Empty staff after a host read is a miss, not a success.
2. An inbox call, when the decision is actually yours.

The keyword map is not first-run.

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

On `construct serve`, omitting namings is an error: the host has to
name. It is not a fall-through to the keyword map. An empty namings
array is a real answer that this implicates nothing.

The keyword map is the zero-model fallback for a plain terminal with no
host wrapping the command — it is not first-run. The terminal command
list lives in [cli-walkthrough.md](cli-walkthrough.md). Construct never
ships its own agent runtime.
