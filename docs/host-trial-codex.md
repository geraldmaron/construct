# Host trial: the projection inside Codex

Dated 2026-08-21. What happened attaching Construct's MCP projection to
`codex exec`, Codex's non-interactive mode, against a real subject. This is a
presence trial, not a dispatch trial: presence held (the server attaches, the
model discovers and calls its tools with well-formed arguments); dispatch — a
call actually reaching and mutating the store — did not, for a reason this
trial diagnosed rather than assumed.

## What was set up

- **Host:** codex-cli 0.145.0 (`codex --version`), signed in through a ChatGPT
  subscription (`codex login status` answers "Logged in using ChatGPT" —
  capacity, not a metered key). This matches `src/hosts/codex/pin.ts`'s
  pinned version exactly.
- **Attach mechanism.** Construct is not one of Gerald's persisted MCP
  servers in `~/.codex/config.toml` (`codex mcp list` before this trial
  named atlassian, computer-use, context7, filesystem, github, linear,
  node_repl, notion, playwright, and sequential-thinking — no construct).
  Rather than add a persisted entry to a config file used for real,
  everyday work, this trial attached construct ad hoc, per invocation, with
  `-c` overrides:

  ```bash
  codex exec --json --ephemeral --skip-git-repo-check -s read-only \
    -c mcp_servers.construct.command=node \
    -c 'mcp_servers.construct.args=["<checkout>/bin/construct.mjs","serve"]' \
    'Call the construct MCP tool named record_outcome with outcome set to exactly: "…"' \
    < /dev/null
  ```

  `--ephemeral` (no session persisted), `--skip-git-repo-check`, `-s
  read-only` (denies writes from any model-run shell command), and stdin
  explicitly closed — the same isolation posture `src/hosts/codex/pin.ts`
  already verifies, applied here to a projection-attach run instead of a
  dispatch run. `~/.codex/config.toml` was never written to: its checksum
  before and after this entire trial is identical
  (`e235f6033c3c402e2c1532c43e579e1d`).
- **Model.** Whichever model `codex exec` resolves — codex's own JSONL
  never names it (`events-never-name-the-model`, already pinned). Runs that
  loaded the real `~/.codex/config.toml` (most of this trial) would resolve
  its `model = "gpt-5.5"`; runs that passed `--ignore-user-config` skip that
  file and resolve to codex's internal default instead. Neither is
  confirmed by any run's own output, so both are stated as inference, not
  measurement.
- **Subject.** The same real, current BlackStory question construct-chno.4's
  goose trial used (`docs/host-trial-goose.md`): "Decide whether canonical
  merges and bulk edits should enforce recent reauthentication
  (`assertRecentReauth`) the same way publish, retract, rights, policy, and
  role changes already do, given the cookie-session path has no `auth_time`
  to check it against" — chosen deliberately, so this trial's result sits
  next to goose's on the identical real input rather than a fresh one.

## What held

The model correctly discovered and called the projection's tools. Asked to
record the BlackStory outcome and propose its own namings, one run's model
first tried `catalog`, got it cancelled (see below), tried once more, still
cancelled, and then made a judgment call worth recording on its own: rather
than invent catalog domain names it had never seen, it left `namings` off
entirely and let `record_outcome` fall through to the deterministic keyword
path, reasoning in its own final message that it would "avoid inventing
catalog domain names because the record call discards anything outside that
list." That is the correct read of the tool's own description, arrived at
without ever seeing the description's warning play out — a small, real
data point that a frontier model reasons about the admission gate correctly
even under a degraded transport. Contrast this with the same scenario later
under Cursor (`docs/host-trial-cursor.md`), whose model filled the identical
gap with five fabricated, non-catalog domain names instead.

Directly against the transport, independent of any host: `echo
'{"jsonrpc":"2.0","id":1,"method":"initialize",...} {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"catalog","arguments":{}}}'
| node bin/construct.mjs serve` answers both requests, correctly, in 0.115s
wall time (`time` measured). Whatever blocked the calls below, it is not
Construct's own server being slow to start or slow to answer.

## What it exposed

**A codex-attached call to an ad-hoc MCP server is blocked before it reaches
Construct, and the block is honest — no phantom write.** Every tool call
against the `-c`-declared `construct` server, across this trial's diagnostic
runs, returned the same shape: `{"error":{"message":"user cancelled MCP
tool call"}}`, `"status":"failed"`, regardless of which tool was called
(`catalog`, `record_outcome`) or how many times.

Three checks ruled out the explanations that would have made this Construct's
problem rather than codex's:

1. **Not slow startup.** The raw timing probe above shows Construct answers
   in about a tenth of a second.
2. **Not workspace trust.** `~/Developer/Projects/construct` is already
   `trust_level = "trusted"` in the real config.toml (Gerald's own prior
   use). Running from inside it, with the real config loaded, produced the
   identical cancellation as running from an untrusted scratch directory
   with `--ignore-user-config`.
3. **Not a blanket "codex exec can't call MCP tools at all."** A control
   call, same invocation shape, same session, against `sequential-thinking`
   — already a real entry in `~/.codex/config.toml`, no auth required —
   completed normally with a real result relayed to the model. Only the
   ad-hoc `construct` server was blocked.

That leaves "declared via `-c` override" as the best-supported distinguishing
variable from this session's evidence, though it was not conclusively
isolated: doing so cleanly would mean running `codex mcp add construct --
node <checkout>/bin/construct.mjs serve`, a real, persisted registration —
which this trial did not do, deliberately, because it would rewrite a config
file Gerald uses for real work, and this bead's rules require that kind of
change to be his call, not a session's.

**This session filed and then retracted a bug on this finding, and the
retraction is worth recording rather than erasing.** The first pass found a
cancelled `record_outcome` call and, moments later, two work-log entries
near that same timestamp for the same outcome text, and concluded —
wrongly — that the call had silently succeeded despite the reported
cancellation. This is a real, live, multi-session store, and both entries
turned out to belong to construct-chno.4's own goose trial running at the
same time on the identical real BlackStory sentence, not to anything this
session did: `docs/host-trial-goose.md` cites its claude-code run as
`run-20260821214915287`, matching the first entry exactly, and its second,
close-behind entry matches that same packet's own description of
reproducing its cache finding directly against the server right after
(`construct-chno.7`). Neither was this session's doing; the coincidence
only looked like proof because two sessions were probing the same shared
store with the same real text at the same time. A follow-up test built to
remove that ambiguity for good — a `record_outcome` call carrying a unique,
never-before-used marker string precisely so any match in the log could
only be this session's own — settled it: the marker never appears. The
cancellation is real and the call never reaches the store. `construct-rws5`
was filed on the wrong read and closed the same session
with the correction on record, once the unique-marker test disproved it.
Corrected, the finding is the same shape as Cursor's (below): a host's own
non-interactive approval gate blocking a write cleanly, not Construct
mishandling anything, and not a host lying about what happened.

## What is unmeasured

- **Real dispatch.** No tool call against the ad-hoc `construct` server ever
  completed. Only presence — attach, discovery, argument-shaping — was
  measured; the projection's actual behavior under codex (what
  `record_outcome`, `catalog`, or any other tool returns when a call gets
  through) was not exercised at all here. Compare `docs/host-trial-goose.md`
  and `docs/host-trial-nanobot.md`, where a call did land.
- **Whether `codex mcp add` (persisted registration) resolves the
  cancellation.** The `sequential-thinking` control makes this plausible —
  it is the one structural difference this trial found between a server that
  works and one that doesn't — but it was not directly tested for
  `construct` itself, for the config-file reason stated above. Confirming
  it needs either Gerald's own action or his explicit go-ahead for a session
  to take it.
- **Interactive `codex` (the TUI), as opposed to `codex exec`.** An
  interactive session has a human to answer an approval prompt; this trial
  never ran one, so whether the same ad-hoc attach works fine there (very
  plausible, since the gate this trial found looks like exactly the kind of
  thing an approval prompt exists to ask about) is untested.
- Sandbox modes other than `-s read-only`, and whether `-a`/`--ask-for-approval`
  (a real flag on the interactive `codex` command, confirmed absent from
  `codex exec` specifically — `error: unexpected argument '-a' found`) has
  any equivalent for `exec`.

## Spend, for the record

Real ChatGPT subscription capacity, not a metered API key — matching
`src/hosts/codex/pin.ts`'s own note that this host spends "the user's
subscription, not an API key," and that cost is honestly unmeasurable per
run (`usage-counts-tokens-not-dollars`; no run in this trial emitted a cost
field, only token counts). Eight `codex exec` invocations reached the model
across this trial's diagnostic path (establishing the cancellation, ruling
out startup time, the `sequential-thinking` control, and the unique-marker
disproof); a ninth attempt failed at argument parsing before any model was
reached (`codex exec` does not accept `-a`, spending nothing). None looped
the same call hoping for a different answer — each tested a distinct,
named hypothesis. Two representative token counts, from this session's own
output: the `sequential-thinking` control used 55,650 input / 165 output
tokens; the main outcome-recording attempt used 97,592 input / 1,401 output
tokens (the larger reasoning trace matches its two retried tool calls before
the model gave up and reported back).
