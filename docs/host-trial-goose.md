# Host trial: the projection inside goose

Dated 2026-08-21. What happened when Construct's MCP projection was attached
to goose, a host nobody at Construct designed it for, against a real subject.
This is a probe-target trial, not an execution-adapter trial: goose is pinned
the way OpenCode is (`src/hosts/goose/pin.ts`), for spawn mechanics and output
shape, not for dispatch. What follows measures presence (the projection
loading and being used through a foreign host's own tool-calling loop), not
dispatch, and stays inside that line on purpose.

**Model and subscription.** The trial that counts ran on goose's
`claude-code` provider: `--provider claude-code --model claude-sonnet-5`,
which goose serves by shelling out to the `claude` CLI already authenticated
on this machine (Claude Code 2.1.239), drawing on Gerald's Claude Code
subscription rather than any API key this session holds or any local model.
Real dollars, on that subscription: $0.1056 for the trial run below. An
earlier exploration, before this sourcing rule was set, ran the same shape of
trial against a local Ollama model (`qwen3.5:4b`) at zero cost; that run is
kept below, clearly labeled, because it is what actually happened first and
it is not without value, but it is not the trial this packet stands on.

## What was set up

- **Host:** goose 1.46.0 (Block, `block/goose`), installed at
  `/opt/homebrew/bin/goose`. `goose --version` prints a leading space then the
  semver, matching `src/hosts/goose/pin.ts`'s `PINNED_VERSION`.
- **Attachment:** `--with-extension "node <checkout>/bin/construct.mjs serve"`
  plus `--no-profile`, which disables goose's own default extension bundle
  (`developer`, carrying shell and file-write tools, plus `todo`, `skills`,
  and the rest of `~/.config/goose/config.yaml`'s enabled set) so the only
  tool surface reaching the model is the construct MCP projection itself.
  This keeps the trial's signal attributable to the projection and, on a
  checkout shared with other live sessions, keeps a coding-shaped model from
  reaching for bash or file writes it was never given a reason to use.
  `--no-session --quiet --output-format json` for a clean, single-shot,
  parseable run.
- **Subject:** a real, current, open item from BlackStory's own
  `docs/decisions-carryover.md` (the same dogfood subject the nanobot trial
  used): "Decide whether canonical merges and bulk edits should enforce
  recent reauthentication (`assertRecentReauth`) the same way publish,
  retract, rights, policy, and role changes already do, given the
  cookie-session path has no `auth_time` to check it against." BlackStory's
  own doc names this exact gap as "tracked as a follow-up on repo-qv9h": a
  real, unresolved question, not a fabricated prompt. The identical text was
  reused across every run in this packet on purpose (see "What it exposed"
  below on why that turned out to matter).

## What held

The claude-code run completed the full loop for real, in one turn, with no
argument mistakes: catalog read, `record_outcome` called with the outcome
text verbatim and a five-domain naming proposal (`security`, `system-design`,
`coverage-gaps`, `measurement`, `compliance`), each with its own stated
reason. Verified independently from the standalone CLI, the way the nanobot
trial's runs were: `construct log --run run-20260821214915287` shows a real,
recorded run with real work-log entries, nothing dispatched, and no
capability token issued: `record_outcome`'s tasks start `pending` and stay
there until `construct work` explicitly dispatches them behind its own spend
ceiling, and with `--no-profile` goose never even had a tool that could call
it. Presence held its line through a host that spawns Construct as a generic
`node` subprocess and knows nothing else about it, running an entirely
different provider than the mechanics probe was ever measured on.

But the run also exposed something neither of us expected. See below.

## What it exposed

**The exact same outcome text served a stale, cached answer instead of this
run's own namings, and the tool description never says that can happen.**
This outcome text had already been consulted once, by the local-model run
recorded further down this packet. Construct's naming cache
(`src/kernel/store/namings.ts`) keys on the outcome string itself: "the first
answer stands, and a second consultation of the same outcome does not
overwrite the reason the first one cited." That is a deliberate, sensible,
documented design for cost control, not a bug. What is a real gap: Claude
noticed this on its own, from the raw tool reply, and said so unprompted in
its final answer without being asked to check for it. In its own words, the
reply's `inferredBy: "cache"` meant its namings "did not take" as submitted,
and it flagged this as worth knowing for anyone who expects namings to be
authoritative.

Reproduced directly against the server, independent of any host or model, to
confirm this is real and not a misreading: a single well-formed naming
(`coverage-gaps`, a real catalog domain, a valid reason) submitted against
the same already-consulted outcome text returns the *old* implicated set from
the first consultation (`security`, `system-design`, `compliance`,
`program-sequencing`, `product-scoping`), puts the new, perfectly valid
proposal in `notAdmitted`, and the only signal anything unusual happened is
`"inferredBy":"cache"` sitting on the same reply. `record_outcome`'s own
description says a naming goes unadmitted for being "outside the catalog or
without a reason" and stops there, reading as an exhaustive list. It is not:
a third, unstated reason exists, and `notAdmitted` does not distinguish which
one applies to a given entry. A capable model caught this by reasoning about
the reply; nothing in the tool's own description would have told it, or a
less careful caller, to expect it. Filed same-day as **construct-chno.7**
(`record_outcome`'s description does not say identical outcome text overrides
namings from a cache).

**goose's `claude-code` provider does not mediate individual tool calls the
way its other providers do.** The whole run produced exactly two messages in
goose's own JSON output: the initial prompt and one final assistant text
message summarizing what it did. No `toolRequest`/`toolResponse` entries
appear anywhere, unlike every ollama-backed run in this packet, which showed
each tool call and its result as separate messages. goose appears to hand the
entire session, including MCP tool orchestration, to the shelled-out `claude`
subprocess and only receive back a finished answer; whatever happened
tool-call by tool-call lives in `claude`'s own session, not goose's.
Everything in this packet's "What held" and the cache finding above was
therefore verified independently against the standalone CLI rather than
trusted from goose's transcript, which is the same discipline the nanobot
trial used and turned out to be necessary here for a different reason than
expected. Worth knowing for anyone building a real goose adapter on the
`claude-code` (or similarly shelled-out) provider: goose's own output is not
where per-tool-call evidence will be.

**Two findings from the earlier local-model exploration still stand, verified
independent of any model.** An unscoped `work_log` call returns the entire
append-only log with no bound (1,385,133 bytes on this store, reproduced
directly against the server), which is **construct-chno.5**. `construct log
--run=<id>` (equals form) silently falls through to that same unscoped dump
instead of the scoped one, while its own sibling `show()` and the
`work`/`verdict` commands already accept that form, which is
**construct-chno.6**. Both were confirmed by direct commands against the
server and the CLI, not by anything a model said, so neither needed
re-verifying on the approved model; both are filed and stand as originally
recorded.

## Preliminary run, on a local model, before the sourcing rule was set

Before "use Gerald's Claude Code or Cursor subscription, not a local model"
was established as the standing rule for this kind of work, this trial ran
twice against a local Ollama model (`qwen3.5:4b`, zero cost, `--provider
ollama --model qwen3.5:4b`) with the identical prompt and subject above. Kept
here because it happened and the record should show what actually happened,
not because it is the trial this packet's findings rest on.

- **Run one failed on the model's own mistake, not the server's.** It called
  `catalog` correctly, then called `record_outcome` with the argument key
  capitalized (`"Outcome"` instead of `"outcome"`). The server rejected it
  correctly and plainly: `{"ok":false,"error":"record_outcome requires a
  non-empty string \"outcome\""}`. goose relayed the error back; the model's
  next turn correctly self-diagnosed the mistake in its own words, and then
  the run simply ended with no retry and no reply text. One run, one small
  model; a stronger model or a second turn would plausibly have recovered,
  and the claude-code run above did not make this mistake at all.
- **Run two completed the loop and became the cached answer the claude-code
  run later collided with.** It read the catalog (surfaced by goose as
  `node__catalog`, named after the extension's launch command rather than
  anything Construct declares), then recorded the outcome with five proposed
  namings (`security`, `system-design`, `compliance`, `program-sequencing`,
  `product-scoping`), all admitted, `inferredBy: "namer"`. One naming
  (`program-sequencing`) reads as a stretch on inspection: its stated reason
  pattern-matches `auth_time` sounding date-related rather than engaging the
  domain's real concern. It carried no stated `confidence`, so the kernel
  admitted it exactly as unconditionally as the strong namings beside it;
  written down as an observation, not grounds to tune anything on one run
  from one small model.

## What is unmeasured

- goose as a dispatch/execution adapter. Not attempted: this bead's own
  DISPATCH note reserves adapter-building as separate, later work, and this
  trial only exercised the read/record-outcome tools presence exposes.
- Every other provider goose can reach (`anthropic`, `openai`, `databricks`,
  `gemini-cli`, and the general "shell out to another agent CLI as a
  provider" pattern, including `cursor-agent`). Only `ollama` and
  `claude-code` were exercised.
- Interactive `goose session` (this trial only used one-shot `goose run
  --no-session`). Multi-turn behavior against the projection is untested on
  either provider.
- Whether goose's default extensions (`developer` and the rest, excluded here
  by `--no-profile`) change model behavior toward the construct tools when
  loaded alongside them. Deliberately not tried, for the safety reason stated
  above.
- `--container`-scoped extension execution, and goose's other transport
  (`--with-streamable-http-extension`): construct only exercised the stdio
  path, which is the one every other pinned host in this repo also uses.
- Whether goose's other shelled-out-CLI providers (`cursor-agent`,
  `gemini-cli`) show the same two-message, non-mediated transcript shape the
  `claude-code` provider did, or whether that is specific to how `claude`
  itself handles a delegated session.
