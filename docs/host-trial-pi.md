# Host trial: pi has no projection surface to attach

Dated 2026-08-21. What happened trying to attach Construct's MCP projection
to pi, a probe target pinned the way OpenCode is (`src/hosts/pi/pin.ts`). The
honest result is that the trial could not get past the attach step: pi has no
MCP client, by its own maintainers' explicit, documented design, and this
packet is the record of checking that claim rather than assuming it.

## What was checked

- **Host:** pi 0.84.2, package `@earendil-works/pi-coding-agent`, not
  `@mariozechner/pi`, an unrelated package with misleading metadata pointing
  at the same GitHub repo (see the pin's own warning on this). Installed
  globally under fnm Node 24.19.0; `pi --version` prints the bare semver.
- **Model:** `~/.pi/agent/models.json` already carried a hand-authored
  `ollama` custom-provider entry (`qwen3.5:4b`, `openai-completions` API
  shape, `http://localhost:11434/v1`) from the earlier probe work: the same
  local, zero-cost model used throughout this bead.
- **Looked for an attach point.** `pi --help`'s complete flag list (options,
  environment variables, examples) has no `--mcp`, `--mcp-config`, or any
  equivalent. There is no `pi mcp` subcommand: `pi`'s only subcommands are
  `install`, `remove`/`uninstall`, `update`, `list`, `config`, `auth`.
- **Checked the primary source rather than assuming.** The installed
  package's own bundled docs settle it in two places. `docs/usage.md` states
  plainly that MCP is intentionally left out of the core, in the same
  sentence as sub-agents, permission popups, plan mode, to-dos, and
  background bash. `README.md`, under a "Philosophy" heading, is just as
  direct: **"No MCP."**, followed by a pointer to build CLI tools with
  READMEs instead (see its Skills section) or to write an extension that adds
  MCP support, with a link to the maintainer's own published reasoning for
  the decision. The same README's feature list places "MCP server
  integration" under what an extension can add, not under what ships
  built in.
- **Checked this machine for an existing bridge.** `pi list` reports "No
  packages installed." and `~/.pi/agent/` has no `extensions/` directory at
  all. Nothing pre-existing on this machine could have carried an MCP
  bridge, so the documentation claim and this machine's actual state agree.
- **Ran it anyway, to see rather than infer.** With no MCP configured
  (because none can be), asked a live pi process what tools it has:

  ```
  pi --print "List every tool you currently have available, by exact name, one per line." \
    --provider ollama --model qwen3.5:4b --no-session --mode json
  ```

  The reply was pi's four default write-capable built-in tools and nothing
  else: `read`, `bash`, `edit`, `write`. No construct-shaped tool exists to
  call, confirming the documentation claim against a real run rather than
  resting on the README alone.

## What this measures

Presence is not reachable. That is a level below the floor this bead's own
2026-08-16 DISPATCH note anticipated as the likely worst case ("if the trial
can only reach presence... rather than dispatch, that is the honest
result"). For pi, there is no supported attach point for presence itself, let
alone dispatch. This is a structural fact about pi's architecture, stated as
a deliberate design choice by pi's own maintainers with a published
rationale, not an accident or a regression. Construct's own docs never
claimed otherwise: `STRATEGY.md` says goose and pi are "probe targets pinned
the way OpenCode is," a claim about spawn mechanics and output shape, already
covered by `src/hosts/pi/pin.ts` and `scripts/probe-pi-conformance.mjs`, not
a claim that pi hosts the projection.

**No bead filed for this.** The instructions for this trial file a bead for
anything it exposes that is a real defect. An accurately-documented,
intentional design choice by a third party that Construct's own docs do not
misrepresent is not a Construct defect; there is nothing here for Construct
to fix.

## What was deliberately not attempted, and why

- **Writing a custom pi extension to bridge MCP.** pi's own docs say this is
  buildable ("build an extension that adds MCP support"). Doing so would be
  building the very host adapter `src/hosts/pi/pin.ts` explicitly defers as
  "separate, later work," out of scope for a probe-target trial; it would
  also measure code written for this trial, not pi's own capability.
- **Installing a third-party pi package that claims MCP support.** None was
  verified to exist, be maintained, or be trustworthy, and pi's own
  documentation warns in its own security section that packages run with
  full system access and that source should be reviewed before installing
  anything third-party. Running unreviewed third-party code with full system
  access on a checkout shared with other live sessions, to force a presence
  measurement, is not what this trial calls for.
- **Driving the `construct` CLI through pi's own `bash` tool.** Possible, but
  not a measurement of pi as an MCP host: every host with a shell tool can
  already do this, including goose, which this trial deliberately excluded
  by default extensions (`--no-profile`) to keep its own measurement
  attributable to the projection rather than to bash. Doing it here would
  not be attaching the projection; it would be running a CLI Construct
  already ships, through a tool pi ships by default, and calling that a host
  trial would overstate what was measured.

## What is unmeasured

- Everything past attach: dispatch, tool schema translation, whether pi's
  tool-calling loop handles the projection's argument shapes any better or
  worse than goose's did. None of it is reachable without new integration
  work this bead does not license.
- Whether a future, reviewed MCP-bridge extension for pi (built as its own,
  separate, later piece of work) would change any of this. Not speculated on
  further here.
