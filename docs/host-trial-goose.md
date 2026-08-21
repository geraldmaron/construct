# Host trial: the projection inside goose

Dated 2026-08-21. What happened when Construct's MCP projection was attached
to goose, a host nobody at Construct designed it for, against a real subject.
This is a probe-target trial, not an execution-adapter trial: goose is pinned
the way OpenCode is (`src/hosts/goose/pin.ts`), for spawn mechanics and output
shape, not for dispatch. What follows measures presence (the projection
loading and being used through a foreign host's own tool-calling loop), not
dispatch, and stays inside that line on purpose.

## What was set up

- **Host:** goose 1.46.0 (Block, `block/goose`), installed at
  `/opt/homebrew/bin/goose`. `goose --version` prints a leading space then the
  semver, matching `src/hosts/goose/pin.ts`'s `PINNED_VERSION`.
- **Model:** a local model through Ollama (`qwen3.5:4b`, the same model the
  probe scripts use), so the run costs nothing and needs no key. Passed
  explicitly as `--provider ollama --model qwen3.5:4b`: goose takes provider
  and model as two separate flags, and an omitted pair falls back to whatever
  the machine's `~/.config/goose/config.yaml` has configured last (on this
  machine, `active_provider: cursor-agent`, a different coding-agent CLI
  shelled out to as a "provider"; see the pin's own note on this). Naming
  both flags explicitly avoided that trap.
- **Attachment:** `--with-extension "node <checkout>/bin/construct.mjs serve"`
  plus `--no-profile`, which disables goose's own default extension bundle
  (`developer`, carrying shell and file-write tools, plus `todo`, `skills`,
  and the rest of `~/.config/goose/config.yaml`'s enabled set) so the only
  tool surface reaching the model is the construct MCP projection itself.
  This keeps the trial's signal attributable to the projection and, on a
  checkout shared with other live sessions, keeps a coding-shaped local model
  from reaching for bash or file writes it was never given a reason to use.
  `--no-session --quiet --output-format json` for a clean, single-shot,
  parseable run, matching the probe script's own invocation shape.
- **Subject:** a real, current, open item from BlackStory's own
  `docs/decisions-carryover.md` (the same dogfood subject the nanobot trial
  used): "Decide whether canonical merges and bulk edits should enforce
  recent reauthentication (`assertRecentReauth`) the same way publish,
  retract, rights, policy, and role changes already do, given the
  cookie-session path has no `auth_time` to check it against." BlackStory's
  own doc names this exact gap as "tracked as a follow-up on repo-qv9h": a
  real, unresolved question, not a fabricated prompt.

## What held

A second run completed the full loop for real. The model:

1. Called `catalog` (surfaced to goose as `node__catalog`; see "What it
   exposed" below on that naming) and got the real 17-domain catalog back
   from `construct 3.0.0-alpha.12`.
2. Called `record_outcome` with the outcome text verbatim and five proposed
   namings (`security`, `system-design`, `compliance`, `program-sequencing`,
   `product-scoping`), each with its own `why` and a stated confidence.
3. Got back `{"run":"run-20260821212338703", ..., "inferredBy":"namer",
   "tasksQueued":5, "notAdmitted":[]}`: every proposed naming passed the
   kernel's admission gate.

Verified independently from the standalone CLI, the way the nanobot trial's
runs were: `construct log --run run-20260821212338703` shows the same five
domains, each marked `(inferred by: namer — a model read the outcome)`, and a
footer reading `5 task(s): 5 pending.` (that phrase is quoted verbatim from
the CLI's own output). Nothing dispatched and no capability token was ever
issued: `record_outcome`'s tasks start `pending` and stay there until
`construct work` explicitly dispatches them behind its own spend ceiling, and
with `--no-profile` goose never even had a tool that could call it. Presence
held its line through a host that spawns Construct as a generic `node`
subprocess and knows nothing else about it.

Cost, for the record: run one (below) totaled 8,619 tokens over 158 seconds;
run two totaled 17,970 tokens over 134 seconds. Both zero dollars, on a local
model.

## What it exposed

**A first attempt failed on the model's own mistake, not the server's.** The
first run (prompted identically) called `catalog` correctly, then called
`record_outcome` with the argument key capitalized: `"Outcome"` instead of
`"outcome"`. The server rejected it correctly and plainly:
`{"ok":false,"error":"record_outcome requires a non-empty string
\"outcome\""}`, `isError: true`. That is the schema working as designed. What
happened next is the finding: goose relayed the error back to the model, the
model's next turn correctly self-diagnosed ("I passed it as an object key
instead of a proper JSON string value"), and then the run simply ended,
`status: "completed"`, with no retry and no reply text. A four-billion
parameter model recognized its own mistake and did not act on the
recognition. This is a model/host loop-termination behavior, not a Construct
defect: the projection's error message was exactly specific enough to name
the missing field, and a stronger model or a second turn would plausibly have
recovered. Recorded as an observation, not a measurement: one run, one small
model.

**An unscoped `work_log` call returns more than a model can hold.** After
recording the outcome, the model, on its own initiative and not instructed
to, called `work_log` with no `run` argument. goose could not inline the
reply: *"The response returned from the tool call was larger (1326114
characters) and is stored in the file..."* Reproduced directly against the
server, independent of goose: the same unscoped call returns 1,385,133 bytes
on this machine's real store, against 23,091 bytes for an unscoped
`run_status`, 7,409 for `asks`, and 17,683 for `inbox` on the same store.
`work_log` is the outlier because it is the literal, ever-growing append-only
table with no cap. Filed same-day as **construct-chno.5** (MCP `work_log`
tool returns the whole unscoped log with no limit, breaking host context
budgets).

**Verifying a run from the CLI surfaced a second, related bug.**
Cross-checking the recorded run the way the nanobot trial did, `construct log
--run=run-20260821212338703` (equals form) silently returned the entire
1,092-line unscoped log instead of the seven-entry scoped one, with no error
and no warning. `construct log --run run-20260821212338703` (space form)
returns the correct, scoped seven entries. `show()` in the same file, and
`work`/`verdict` elsewhere, already accept both forms; `log` alone does not.
Filed same-day as **construct-chno.6** (`construct log --run=<id>` silently
ignores the flag and dumps the whole log instead of erroring).

**goose names a stdio extension after its command, not a declared name.**
`--with-extension "node .../construct.mjs serve"` surfaced every projection
tool under the prefix `node__` (`node__catalog`, `node__record_outcome`,
...) and `_meta.goose_extension: "node"` on each tool call, derived from the
extension's launch command rather than anything Construct declares. Harmless
here (nothing else was loaded to collide with it under `--no-profile`), but
worth knowing for whoever eventually writes a real goose adapter: the
CLI-shorthand `--with-extension` form has no `name=` field the way
`~/.config/goose/config.yaml`'s YAML extension entries do (each of those
carries an explicit `name:` key), so two `node`-launched stdio extensions
attached this way would collide on display name. An observation, not a
defect: goose's own config format already has the fix, just not through this
flag.

**One naming looked like a stretch, and nothing distinguished it from the
confident ones.** Of the five domains the model named, `security` (its
primary read) and `compliance` are direct, defensible reads of a
reauthentication-enforcement question. `program-sequencing` is not: its
stated reason ("whether dates are real and the order/dependencies of updates
in cookie-session") reads as the model pattern-matching on `auth_time`
sounding date-related, rather than engaging with the domain's actual concern
(order, dependencies, whether a shipped date is real). Unlike the first run,
which did attach a `confidence` to each naming, this run's `record_outcome`
call left `confidence` off every one of the five, `program-sequencing`
included, which per the tool's own description ("leave it out when you are
simply sure") reads as full confidence throughout. The kernel admitted all
five unconditionally: the below-0.5 coverage-gap path only engages when a
model states its own doubt, and this run never gave it the chance, on its
weakest naming or any other. One run, one small model, written down as an
observation the way nanobot's "measurement" mis-naming was, not grounds to
tune anything.

## What is unmeasured

- goose as a dispatch/execution adapter. Not attempted: this bead's own
  DISPATCH note reserves adapter-building as separate, later work, and this
  trial only exercised the read/record-outcome tools presence exposes.
- Every other provider goose can reach (`anthropic`, `openai`, `databricks`,
  `gemini-cli`, `claude-code`, and the "shell out to another agent CLI as a
  provider" pattern the pin documents). Only `ollama` was exercised.
- Interactive `goose session` (this trial only used one-shot `goose run
  --no-session`). Multi-turn behavior against the projection, and whether a
  model recovers from a tool-argument mistake given a second turn, is
  untested.
- Whether goose's default extensions (`developer` and the rest, excluded here
  by `--no-profile`) change model behavior toward the construct tools when
  loaded alongside them. Deliberately not tried, for the safety reason stated
  above.
- `--container`-scoped extension execution, and goose's other transport
  (`--with-streamable-http-extension`): construct only exercised the stdio
  path, which is the one every other pinned host in this repo also uses.
