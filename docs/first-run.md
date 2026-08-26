# Your first run

You talk. Staff shows up. That is first run.

You are already in a session that can call tools — Cursor, Claude Code,
Codex, OpenCode, or IBM Bob. Say what you are looking at, in ordinary
language. No catalog words. No `--host`. Point that session at Construct:

```bash
construct serve
```

This session reads your words and names the concerns, or it routes to
inbox, verdict, or log when that is the call. The host decides the path.
Construct does not map phrases to seats. The keyword map is not first-run.

When the host names domains, it calls `record_outcome` with those namings.
Tasks queue under the names the host chose. The same session pulls the
next one with `claim_task` and writes the finding back with `submit_work`.
You never leave the conversation to type a verb. Construct will not spawn
a second CLI. Empty staff after a host read is a miss, not a success.

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
else stays in the conversation you are already having. Verdict and log
are the same class of surface when the host routes there.

## This session can dispatch

The surface can dispatch work. When a secret is set, `claim_task` and
`submit_work` are on the same socket: the session that just named the
outcome is the session that pulls the next task. Product `serve` creates
that secret. Construct does not spawn a second agent to do the work.

What stays off the socket is `promote`, `review`, `compose`, a CLI `ask`,
and erasure — human-gated or destructive.

On `construct serve`, omitting namings is an error: this session has to
name, or say it needs a host that can. It is not a fall-through to the
keyword map. An empty namings array is a real answer that this implicates
nothing.

The keyword map is the zero-model fallback for a plain terminal with no
host wrapping the command — it is not first-run. The terminal command
list lives in [cli-walkthrough.md](cli-walkthrough.md). Construct never
ships its own agent runtime.
