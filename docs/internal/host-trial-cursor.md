# Host trial: the projection inside Cursor

Dated 2026-08-21. What happened attaching Construct's MCP projection to
`cursor-agent`'s non-interactive `-p` mode, against the same real subject
`docs/internal/host-trial-codex.md` used. Like that trial, this is a presence
measurement, not a dispatch one: presence held completely (attach,
connection, full and correct tool-schema discovery). Dispatch (a tool call
actually reaching Construct) was blocked, cleanly, before it left the host.

This trial also covers why the second host is Cursor rather than OpenCode.
A standing directive from Gerald, given mid-session, ruled out Ollama and
any other local model for this bead's remaining work and asked that
OpenCode be tried only if it can reach a subscription-backed model. It
cannot, from this machine, tonight; see the last section.

## What was set up

- **Host:** cursor-agent 2026.08.11-e8db854 (`cursor-agent --version`),
  matching `src/hosts/cursor/pin.ts`'s pinned version exactly. Signed in as
  `geraldmdagher@outlook.com` (`cursor-agent status`): a Cursor
  subscription, not a metered key.
- **Attach mechanism.** Unlike codex, nothing needed adding: `construct-mcp`
  is already a real, persisted entry in `~/.cursor/mcp.json`, launching
  `node <checkout>/bin/construct.mjs serve`, verified byte for byte to
  match the entry `docs/host-interaction.md` already documents. Neither
  `~/.cursor/mcp.json` nor `~/.cursor/cli-config.json` (Cursor's separate
  runtime-state file, read for diagnosis below) changed mtime across this
  entire trial; nothing here wrote to either.
- **Model.** Cursor's `-p --output-format json` envelope does not name the
  model that served a call, already pinned (`envelope-never-names-the-model`),
  confirmed again by this trial's own output. `~/.cursor/cli-config.json`
  names `gpt-5.1` ("GPT-5.1 Medium") as the configured default; that is
  inference from local config, not something either run's own JSON confirms.
- **Subject.** The identical BlackStory reauthentication question
  `docs/internal/host-trial-codex.md` and `docs/internal/host-trial-goose.md` used, so all
  three hosts' handling of the same real input sits side by side.
- **Safety posture.** `cursor-agent -p`'s own help text warns it "has access
  to all tools, including write and shell" by default. This trial ran from
  an empty scratch directory (not this shared checkout), with `--sandbox
  enabled`, `--trust` (grants the pinned workspace-trust gate for the
  invocation, `workspace-trust-gates-headless-runs`), and a prompt
  explicitly scoped to the MCP calls alone ("Do not use any other tool - no
  file reads, no shell, no edits"). `--force`/`--yolo` ("Run Everything")
  was deliberately not used; see below.

## What held

`cursor-agent mcp list` names `construct-mcp: ready` before this trial did
anything. `cursor-agent mcp list-tools construct-mcp`, a read-only
introspection call with no model involved, names all thirteen tools the
projection actually exposes, each with its real argument names (`catalog
()`, `record_outcome (outcome, namings)`, `record (id)`, `verdict (run,
confirm, dismiss, missed)`, and the rest), an exact match against
`src/hosts/mcp/projection.ts`'s `PROJECTION_TOOLS`. Presence, including
full schema fidelity, is real and already working here: this is the one
part of this trial that did not need diagnosing.

## What it exposed

**A `-p` call is rejected at the MCP layer, honestly, even against an
already-"ready", already-approved server.** Two runs, two different flag
combinations, same result:

```
"result": "construct-mcp catalog call return: Tool rejected: User rejected MCP: construct-mcp-catalog"
"result": "{\"error\":\"User rejected MCP: construct-mcp-catalog\"}"
```

`--approve-mcps` ("Automatically approve all MCP servers") was passed on
every run and made no difference. Removing `--sandbox enabled` made no
difference either, ruling out the sandbox as the cause, the same way
codex's read-only sandbox was ruled out in its own trial.

Reading `~/.cursor/cli-config.json` (permitted here as local
troubleshooting, not modified) explains it: `"approvalMode": "allowlist"`,
and `"permissions": {"allow": ["Shell(ls)"], "deny": []}`, no MCP entry of
any kind on the allow list. `mcp list`'s "ready" reflects the transport
connecting successfully, a fact about the server; the allowlist is a
separate, per-tool-call gate on whether a specific action may run without
asking, and `--approve-mcps` (a server-connection flag) does not touch it.
With no one to answer an approval prompt in `-p` mode, the call is refused
before it ever reaches Construct.

Verified directly: neither run left any trace in the real store. The
work-log entry count is identical before and after both attempts, and
neither of them ever appears in it.

**Denied a working `catalog` call, one run's model fabricated five
plausible-sounding domain names instead of saying it could not name
anything real.** Asked to propose namings after both tool calls came back
rejected, the model invented `auth-session-integrity`,
`privileged-action-reauth`, `content-governance-and-publishing`,
`access-rights-and-policy-governance`, and `authn-telemetry-and-cookie-sessions`,
none of which exist in Construct's real seventeen-domain catalog, each
carrying its own invented confidence score, explicitly labeled "conceptual
… you could map to catalog entries yourself." None of this ever reached
`record_outcome` (the call itself was rejected, so nothing was ever sent
for the kernel's admission gate to check), so the gate was never actually
tested by it, but it is exactly the failure mode that gate exists for,
arriving unprompted, and it is a sharper version of the same thing than
codex's model showed on the identical prompt (`docs/internal/host-trial-codex.md`):
where codex's model recognized it had nothing grounded to offer and
declined, cursor's model filled the gap with invention. One run, one model,
recorded as an observation about this specific call, not a measurement of
either model in general.

**No bead filed for either finding.** Both read the same way the pi and
goose trials' non-Construct findings already read (`docs/internal/host-trial-pi.md`,
`docs/internal/host-trial-goose.md`): a real, host-owned behavior with nothing in
this repository to change. Construct's server is not part of the rejection,
cursor refuses before the call is ever sent, and normal, interactive Cursor
use (a person in the IDE, who sees and answers the approval prompt
directly) is not affected by any of this; only the specific combination of
headless `-p` invocation and zero pre-approved MCP entries is. The
fabrication is a model-behavior observation on one run, not a defect in
Construct's admission gate, which the fabricated names never reached.

## What is unmeasured

- **Real dispatch.** As with codex, no tool call against `construct-mcp`
  ever completed under `-p`. Only presence was measured.
- **Whether granting the specific allowlist entry unblocks it.** Plausible,
  and cheap to check (`cursor-agent mcp enable construct-mcp`, or an edit to
  `cli-config.json`'s `permissions.allow`), but both would durably change
  Gerald's own Cursor configuration, which this trial's rules reserve for
  his own action. `--force`/`--yolo` would very likely also unblock it
  without touching any file, but it removes every confirmation gate at
  once, including for shell and file writes, and this trial declined to run
  it on a checkout shared with other live sessions even from an empty
  scratch directory, on the judgment that the diagnostic value did not
  justify the risk.
- **Interactive Cursor** (the IDE's own chat panel, or `cursor-agent`
  without `-p`), where a human sees and can answer the approval prompt
  normally. Not attempted; very likely unaffected by any of this, since
  `mcp list` already shows the server connected and ready.

## OpenCode: checked, no subscription-backed model reachable

Per the standing directive above, OpenCode was checked rather than trialed.
The real binary, `/opt/homebrew/bin/opencode` (1.15.4): the bare `opencode`
on PATH is a shell function, reconfirmed fresh tonight, and it refuses
outright without `OPENROUTER_API_KEY` ("this Claude Code session wasn't
launched via the op-wrapped 'claude' alias"), which is a metered key, not
a subscription, and this session does not have one set regardless.

`opencode auth list` shows four stored credentials: GitHub Copilot (oauth),
"OpenCode Go" (api), ollama (api), and corsair (api). `opencode models`
(405 catalog entries) names only four provider prefixes: `anthropic`,
`corsair`, `ollama`, `openrouter`. Neither `github-copilot` nor
`opencode-go` names a single model. Stored credentials for both exist; no
model id exists to invoke either through. Confirmed directly rather than
inferred from the catalog alone:

```
opencode run --model github-copilot/gpt-4o "reply with exactly: pong"
Error: Model not found: github-copilot/gpt-4o. Did you mean: gpt-5.4-nano?
```

`corsair`'s own model list is the same tag set Ollama's local install
carries (`gpt-oss:20b`, `qwen3.5:4b`, `qwen3.6:35b`, `glm-4.7-flash`,
`qwen3-coder-next`, `qwen3:8b`), which reads as a relay in front of the same
local models rather than a distinct subscription, so it does not qualify
either under the "no local model" directive. `anthropic/*` models are
listed in the catalog but carry no stored credential in `auth list`; this
session's environment carries `ANTHROPIC_BASE_URL` but no
`ANTHROPIC_API_KEY`, so nothing makes them reachable without supplying a
metered key, which was not done.

What would be needed: either OpenCode's own GitHub Copilot or "OpenCode Go"
integration would need to expose an invocable model id (a gap in OpenCode
itself, not in this repository), or a metered `ANTHROPIC_API_KEY` /
`OPENROUTER_API_KEY` would need to be supplied and named as billed spend,
neither of which this trial's directive licenses. Nothing here is a
Construct gap; it is why Cursor, not OpenCode, is this bead's second trial.

## Spend, for the record

Real Cursor subscription capacity, not a metered key. Two `-p` invocations
reached the model: `27,483` input / `2,449` output tokens (the run that also
asked for proposed namings, hence the larger output) and `24,480` input /
`406` output tokens (the catalog-only rejection). `cursor-agent mcp list`
and `cursor-agent mcp list-tools` are local introspection against the
configured server list and a live `tools/list` call respectively: no model
consulted, no cost either way. The OpenCode check above spent nothing: every
command either failed before dispatch or was a local catalog/auth read.
