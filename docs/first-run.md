# Your first run

Talk in the host you already have, in ordinary language. A run exists.
A seat you did not name can show up from the ground Construct can see
— the repos, directories, and sources in reach, plus the words you
said.

That is first run. You never type a catalog word, a CLI verb, or
`record_outcome`. You do not have to know a keyword map or a catalog
exists. Construct is the brain: it may add seats the host or you did
not name.

```bash
construct init
construct serve --client=<host> --project=<root>
```

The shipped binary does not meet that bar. Ordinary talk that leaves
an empty work log is still a miss, and `start_run` without concerns still
leaves staffing to this session. Do not expect staff to appear from talk
alone, and do not expect Construct to add dark-corner seats from
ground it can see.

The old first-run rule said the host infers and Construct does
not classify, name, or route — omitted namings were an error on
purpose. That is what an older surface still did. It is not the product.

Two surfaces only:

1. Dispatch through this session. Once a run exists, this session
   claims work through `next_work` / `submit_work` on interactive MCP.
   You never leave the conversation to type a verb. Construct will not
   spawn a second CLI. Empty staff after a host read is a miss, not a
   success.
2. An inbox call, when the decision is actually yours.

The keyword map is not first-run and is not the inferrer. The
terminal command list lives in [cli-walkthrough.md](cli-walkthrough.md).
Construct never ships its own agent runtime.

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

The host can relay that same call (`decide`). You do not have to leave
the conversation to type the verb. An empty inbox is a real answer:
nothing needs you right now. Everything else stays in the conversation
you are already having.

## This session can dispatch

The surface can dispatch work. After `construct init`, interactive MCP
exposes `next_work` and `submit_work` on the same socket: the session
that just started the run is the session that pulls the next task.
Construct does not spawn a second agent to do the work.

What stays off the socket is `promote`, `review`, `compose`, a CLI `ask`,
and erasure — human-gated or destructive.

On interactive `construct serve`, empty concerns on `start_run` means
none — that is a real answer that this implicates nothing, not a fall
through to the keyword map.

The keyword map is the zero-model fallback for a plain terminal with no
host wrapping the command — it is not first-run and it is not the
inferrer. The terminal command list lives in
[cli-walkthrough.md](cli-walkthrough.md).
