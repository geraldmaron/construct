# Your first run

Talk in the host you already have, in ordinary language. After
`construct init`, Construct is present in that session: format-v1 project
state, the operational `construct` skill, and session-bound MCP where an
adapter exists. A run starts from that conversation. You never type a
catalog word or a CLI verb wall. You do not learn a keyword map to get
started.

```bash
construct init
# optional: construct init --client=cursor   # claude-code / vscode / opencode
```

Init plants the operational skill into the ambient (or `--client`) host
skills directory and reconciles MCP for Claude Code, Cursor, VS Code, and
OpenCode. Bob and Codex may still need a manual
`construct serve --client=… --project=…` entry — fallback wiring, not the
product door.

Two surfaces only:

1. Dispatch through this session. Once a run exists, this session claims
   work through `next_work` / `submit_work` on interactive MCP
   (`start_run` starts the run). You stay in the conversation. Construct
   will not spawn a second CLI for that path.
2. An inbox call, when the decision is actually yours.

The methods in play are investigative-research, decision-framing, and
intake — how the work is done, not job-title seats.

## When the call is yours

The only Construct-shaped surface is an inbox card, and only when the
decision is actually yours: what happened, what you decide, one action.

```
inbox (1):

  dec-…  Should the public claim stay up?

      evidence-provenance: hold [deliverable:…]
      coverage-gaps: challenge [deliverable:…]

Resolve with: construct inbox decide <id> "<your call>"
```

The host can relay that same call (MCP `decide`). You do not have to leave
the conversation. An empty inbox is a real answer: nothing needs you right
now.

## This session can dispatch

The surface can dispatch work. After `construct init`, interactive MCP
exposes `start_run`, `next_work`, and `submit_work` on the same socket:
the session that holds the conversation pulls the next task. Construct
does not spawn a second agent to do that work.

What stays off the socket is destructive or human-gated practice that
belongs in the terminal.

Empty concerns on `start_run` means none — a real "implicates nothing"
answer, not a fallthrough to keywords. The keyword map is measurement and
fallback history only; it is not first-run and not the product inferrer.
Terminal verbs live in [cli-walkthrough.md](cli-walkthrough.md). Construct
never ships its own agent runtime.
