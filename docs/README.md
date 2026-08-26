# Documentation

Everything here is written for someone using Construct. The records of how it
was built — dated probe transcripts, acceptance packets, design decisions,
measurement runs — are in [`internal/`](internal/), separately, so that a reader
can tell which they are holding.

This list is the whole of it, and a lint holds it to that: a new file in this
directory has to be added below, which is the moment someone decides it is
documentation rather than a record.

## Start here

- [`first-run.md`](first-run.md) — talk in the host you already have; staff
  shows up. The only Construct-shaped surface is an inbox card when the
  call is yours.
- [`start.md`](start.md) — the same first-run story, at `/start`.
- [`cli-walkthrough.md`](cli-walkthrough.md) — the terminal command
  walkthrough. Not first-run.
- [`consumer-install.md`](consumer-install.md) — putting Construct inside a
  different repo, an app you are building rather than Construct itself.

## Using it

- [`host-mcp-recipes.md`](host-mcp-recipes.md) — pointing a host at the official
  vendor-run MCP servers for Jira, Confluence, GitHub, Linear, and Google
  Workspace. Configuration, not connector code.
- [`scheduled-operation.md`](scheduled-operation.md) — running Construct on a
  schedule. It has no scheduler of its own, on purpose; this is what it has
  instead.
- [`example-deliverable.md`](example-deliverable.md) — one worked example of
  what Construct hands back, and the reference for its voice.

## Reference

- [`org-map.md`](org-map.md) — which seat answers for each concern. Generated
  from the catalog; the gate regenerates and compares, so it cannot drift.
- [`model-family-promotion.md`](model-family-promotion.md) — what a model family
  passes to move from best-effort to tuned, written down so promotion is a
  procedure rather than one session's memory.
- [`exit-codes.md`](exit-codes.md) — the complete `0`/`1`/`2` exit-code
  contract every verb returns, and the one process-level exception to it.
