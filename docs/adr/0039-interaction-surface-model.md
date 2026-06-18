<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0039: Interaction-surface model — CLI as substrate, agent/MCP/TUI/dashboard as the surfaces that get emphasized

- **Date**: 2026-06-17
- **Status**: proposed
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none

<!-- Owning specialist: cx-architect. Audit epic construct-ij31, bead construct-ij31.18. -->

## Problem

Construct ships 110 commands behind one flat `construct <verb>` dispatcher — verified by
`node scripts/audit/00-inventory.mjs` this session: **110 commands, 13 core, 18 internal,
22 lazy-import handlers** (matching `00-inventory.mjs:80`). The registry
(`lib/cli-commands.mjs`) is the single source of truth, and it is internally honest about
visibility — `core: true` shows 13 commands in default `--help`, `internal: true` hides 18
from help and completions. But visibility is not the same as *interaction surface*. The flat
CLI treats a once-per-machine `install`, a daily authored `intake classify`, a CI-only
`lint:comments`, and an interactive `intake show` as if they were the same kind of thing: a
verb a human types at a prompt.

That framing is now provably wrong for a large fraction of the surface. The MCP server
(`lib/mcp/server.mjs`) already exposes **52 tools** (header comment, `server.mjs:6`) that
duplicate the *daily authored* CLI verbs as machine-callable, JSON-enveloped tools:
`triage_recommend` mirrors `intake classify` / `graph recommend`, `workflow_invoke` mirrors
`workflow invoke`, `capability_describe` mirrors `capability describe`,
`construct_execution_resolve` mirrors `execution resolve`, `model_resolve` mirrors
`models resolve`, `orchestration_run`/`orchestration_status` mirror `orchestrate run`/`status`
(server.mjs:1118-1215, dispatch table 1268-1356). The everyday authoring work an agent does is
*already* MCP-native; the CLI verbs for that same work exist mostly as the `--json` embedded
contract behind them. Meanwhile the CLI is still documented and discovered as one undifferentiated
list, so the human reading `--help` cannot tell which 13 verbs they will ever type by hand from
the ~70 that an agent reaches through MCP or that CI fires in a hook.

The cost of not deciding: every new capability defaults to "add a flat CLI verb," the MCP/CLI
duplication grows without a rule for which is canonical, and the human-facing surface keeps
absorbing commands no human runs interactively. The decision this forces is not *what to remove*
— nothing is broken at the dispatch layer — but *what surface each command group is primarily
for*, so that discovery, documentation, and future additions route to the right place.

## Context

- **The CLI is the substrate, by design.** ADR-0001 (zero-npm-core) makes the registry-driven
  dispatcher the spine; ADR-0022 explicitly frames every other surface as a *thin client* over
  the engine ("the engine owns orchestration; the editor is a thin client"). The dashboard daemon
  and `orchestrate run --remote` are already thin clients over the same runtime. So a tiered
  surface model is not a new architecture — it is naming a posture the codebase already half-holds.
- **MCP is the daily-work surface today.** `lib/mcp/server.mjs` curates a **7-tool flat core**
  (`CORE_TOOL_NAMES`, server.mjs:1223-1226: `orchestration_policy`, `get_skill`, `search_skills`,
  `knowledge_search`, `memory_search`, `project_context`, `summarize_diff`) and collapses the
  long tail behind a `construct_call` meta-tool to keep the serialized surface small — the same
  small-surface discipline ADR-0038/0032 apply to prompts. The "embedded contract" verbs
  (`--json` on `intake classify`, `graph recommend`, `workflow invoke`, `capability describe`,
  `execution resolve`, `models resolve`) exist precisely so an agent or thin client can call them;
  the human CLI form is the secondary face.
- **Prior audit findings already point here.** The proliferation synthesis
  (`docs/research/2026-06-construct-audit/80-synthesis.md`, item 2) found the always-on agent
  surface should stay tiny and the long tail load by trigger — the same principle applied to
  prompts and skills. The tooling scorecard (`docs/audit/tooling-scorecard.md`) deferred the
  *prompt/visual* layer ("re-grade in Phase 5") and flagged the `tty-prompts` interactive layer as
  the open design question — i.e. the interactive surface is under-developed relative to the CLI.
- **The interactive and visual surfaces exist but are thin.** `lib/tty-prompts.mjs` (menus,
  multiselect) and `--select` flows (`construct dev --select`, `profile create` interactive,
  `intake show`) are the embryonic TUI; `lib/server/` is the dashboard. Both are real but neither
  is the primary documented path for the review/telemetry work they are best at.

## Decision

Adopt a **tiered interaction-surface model** over the existing flat CLI. The CLI registry remains
the single substrate and source of truth — **nothing is removed, no verb is broken** — but every
command group is assigned a *primary surface* that governs where it is discovered, documented, and
where new capability of that shape should land:

- **(a) Agent / MCP-native** — daily authored work. The MCP tool is canonical; the CLI verb is the
  scriptable `--json` embedded-contract twin.
- **(b) Thin human CLI** — setup, ops, lifecycle one-shots. The CLI verb is canonical and primary;
  this is the only tier a human is expected to type by hand. It stays the 13-ish `core: true` set
  plus lifecycle verbs.
- **(c) TUI (interactive)** — review/triage/selection work that wants a stateful interactive loop,
  not a one-shot. The CLI verb stays as the non-interactive entry; the interactive flow is the
  emphasized face.
- **(d) Dashboard** — visual/telemetry/observability. The HTTP daemon surface is canonical for
  rendering; the CLI verbs stay as the headless/JSON data source.
- **(internal)** — harness/CI only. Already correctly modeled by `internal: true`; no human or
  agent surface, by design.

The rule going forward: **a command's primary surface is declared, and discovery follows the
surface.** New daily-authoring capability lands as an MCP tool first (CLI `--json` twin for
scripting); new visual capability lands on the dashboard first; only genuine setup/ops verbs grow
the human CLI.

## Surface map

Classification of every command group. **Real caller** is derived from the registry
(`core`/`internal` flags, description, usage), the `bin/construct` handler, and whether an
equivalent MCP tool exists in `lib/mcp/server.mjs`. **Disposition**: `keep-CLI` (stays primary on
the human CLI), `promote-MCP` (MCP is/should be canonical, CLI is the `--json` twin),
`emphasize-TUI`, `emphasize-dashboard`, `internal`.

| Command group | Primary surface | Real caller | Disposition |
|---|---|---|---|
| `install`, `init`, `init:update`, `uninstall`, `update`, `upgrade`, `sync`, `completions`, `backup`, `config` | (b) thin CLI | human, one-shot setup/lifecycle | keep-CLI |
| `dev`, `dashboard`, `stop`, `status`, `doctor`, `cleanup`, `embed`, `scheduler` | (b) thin CLI | human ops; some daemon-backed | keep-CLI (status/doctor also feed dashboard) |
| `creds`, `providers`, `provider`, `auth:status`, `mcp`, `ollama`, `integrations`, `hosts`, `models`(set) | (b) thin CLI | human, credential/integration ops | keep-CLI |
| `intake` (classify), `graph` (recommend), `workflow` (invoke), `capability` (describe), `execution` (resolve), `models` (resolve), `orchestrate` (run/status) | (a) agent/MCP | agent, daily authored work | promote-MCP — MCP tool canonical (`triage_recommend`, `workflow_invoke`, `capability_describe`, `construct_execution_resolve`, `model_resolve`, `orchestration_run/status`), CLI `--json` is the twin |
| `search`, `ask`, `knowledge` (index/add/trends), `memory`, `distill`, `infer`, `ingest`, `drop`, `reflect`, `bootstrap` | (a) agent/MCP | agent + occasional human | promote-MCP where an MCP tool exists (`knowledge_search`, `memory_search`, `ingest_document`, `infer_document_schema`, `knowledge_add`); CLI stays for human one-shots |
| `export`, `wireframe`, `headhunt` | (a) agent/MCP or (b) CLI | agent-authored, human-runnable | promote-MCP (`document_export` exists); CLI kept as headless twin |
| `profile` (create/set/show/list/drafts/archive/health), `customer`, `workspace`, `tags`, `team`, `handoffs`, `recommendations` | (c) TUI for interactive, (a) MCP for read | human-interactive + agent-read | emphasize-TUI for create/assign/review; MCP read tools exist (`profile_*`) |
| `intake` (list/show/done/skip/reopen), `sandbox` (create/list/delete) | (c) TUI | human, interactive triage/review | emphasize-TUI (one-shot CLI kept) |
| `review`, `optimize`, `telemetry`, `telemetry-backfill`, `eval-datasets`, `llm-judge`, `evals`, `efficiency`, `feedback:*` | (d) dashboard | human review + CI; agent reads via MCP (`efficiency_snapshot`, `cx_trace`/`cx_score`) | emphasize-dashboard for visual; CLI/MCP stay as data source |
| `docs` (check/verify/update), `docs:*`, `audit`, `doc` (verify/inspect), `decisions`, `policy`, `gates:audit`, `deployment`, `ci`, `validate`, `diff`, `list`, `role`/`roles:*`, `skills`, `storage`, `plugin`, `acp`, `claude:allow`, `beads`/`beads:stats`, `hooks:health`, `version` | (b) thin CLI / CI | human ops + CI gates | keep-CLI |
| `hook`, `lint:agents`, `lint:comments`, `lint:contracts`, `lint:research`, `lint:templates`, `lint:prompts`, `specialist`, `migrate`, `dashboard:sync`, `seed-traces`, `registry:status`, `evaluator:rubrics`, `activation:status`, `prune`, `overrides`, `resources` (18 `internal: true`) | internal | CI / harness | internal — no human or agent surface, correctly modeled |

One-line read per tier:
- **(a) agent/MCP-native** — the daily authoring verbs already have canonical MCP tools; the CLI
  form is the `--json` scripting twin, not the primary face.
- **(b) thin human CLI** — setup/ops/lifecycle/CI-gate verbs; the ~13 `core` set plus lifecycle and
  integration verbs are what a human actually types.
- **(c) TUI** — interactive triage, profile/workspace authoring, and sandbox/intake review want a
  stateful loop; the CLI one-shot stays underneath.
- **(d) dashboard** — telemetry, evals, review, and feedback are visual/observability work; the CLI
  and MCP forms remain the headless data source.
- **internal** — 18 harness/CI verbs, already invisible to both human and agent by design.

## Rationale

The tiered model is the only framing that matches what the code already does. The MCP server's own
small-flat-core-plus-`construct_call` design (server.mjs:1218-1255) is an explicit statement that
the daily-work surface should be tiny and curated, not a flat 52; ADR-0022 already declares hosts
to be thin clients over the engine; the embedded-contract `--json` verbs exist *because* the agent,
not the human, is their caller. Grading "flat CLI for all 110" against this evidence fails: it
forces a human-typing-a-verb mental model onto commands whose verified primary caller is an agent
(`triage_recommend` etc. are registered MCP tools, server.mjs:1119/1136/1185) or CI (the 18
`internal` verbs). A tiered model lets discovery and documentation tell the truth about who calls
what, and gives every future capability a default home, which is what stops the flat list from
growing without a rule.

It is also non-destructive, which is the decisive practical property. The CLI registry stays the
substrate and single source of truth; `00-inventory.mjs` parity stays clean (it verified
0 handler-orphans, 0 catalog-only this session); no verb is removed or renamed. The tiers are a
*posture and a routing rule*, layered on top — exactly the reversible shape ADR-0033 used when it
turned scattered per-host facts into a declared registry without changing behavior.

## Rejected alternatives

- **Keep the flat CLI for all 110, change nothing.** Rejected: it is not a null choice, it is an
  active decision to keep mismodeling caller intent. The evidence that the daily-authoring verbs
  are already MCP-native (52 registered tools duplicating the `--json` CLI twins) means "flat for
  all" leaves a real duplication with no rule for which surface is canonical, and every new verb
  defaults to growing the human CLI regardless of who will call it. The cost compounds: the human
  `--help` story degrades as agent/CI verbs accumulate in the same list.
- **Full TUI-first.** Rejected: most of the surface has no interactive loop and should not — `hook`,
  `lint:*`, `ci`, `migrate`, and the embedded-contract `--json` verbs are non-interactive by
  nature (CI and agents call them headless). A TUI-first posture would wrap one-shot and machine
  verbs in interaction they don't want, and the interactive layer (`lib/tty-prompts.mjs`) is the
  very component the tooling scorecard flagged as the *least* mature ("re-grade in Phase 5"). TUI
  is the right *emphasis* for a bounded set (triage, profile authoring, sandbox review), not the
  organizing principle.
- **Dashboard-first.** Rejected: the dashboard is the right primary surface for visual/telemetry
  work (review, evals, feedback) but is a poor fit for setup/ops one-shots and for the headless
  agent/CI verbs that must run without a browser or daemon. Making it primary would invert
  ADR-0022's thin-client posture (the daemon is a client of the engine, not the front door) and
  couple lifecycle commands like `install`/`init` to a running server they predate.

## Consequences

- **Audit findings split by surface.** Findings against a command's *behavior* (a broken flag, a
  missing doc, an unstamped artifact) stay **fix-in-place** on whatever surface owns the command.
  Findings that a command is *discovered in the wrong place* (an agent-only verb cluttering human
  `--help`, a visual workflow buried as a JSON CLI dump) become **relocate-surface** — re-home the
  emphasis, not the code. This gives the rest of the audit a clean sorting rule.
- **A migration sketch, phased and non-breaking.** Phase 1: add a `surface` field (or derive it) to
  `lib/cli-commands.mjs` so the primary surface is declared data, not folklore — reuses the
  `core`/`internal` precedent. Phase 2: documentation and `--help` group by surface (human CLI tier
  shown by default; agent/MCP, TUI, dashboard tiers cross-linked, not dumped). Phase 3: for the
  promote-MCP group, document the MCP tool as canonical and the CLI `--json` as the twin. Phase 4:
  invest the emphasize-TUI / emphasize-dashboard groups into their interactive/visual surface as
  capacity allows. At no phase is a verb removed; the CLI stays callable throughout.
- **A default home for new capability.** New daily-authoring capability lands as an MCP tool first;
  new visual capability lands on the dashboard first; the human CLI grows only for genuine setup/ops
  verbs. This is the durable effect — it stops the flat list from accreting.
- **New constraint.** The surface assignment must stay honest: if a command's primary caller
  changes, its declared surface must change with it, or the model rots back into a flat list with
  extra metadata. This is a maintenance obligation, enforceable later by an inventory check that the
  declared surface matches the presence/absence of an MCP twin.

## Reversibility

Two-way door. The model is a declared posture plus a routing rule layered over an unchanged
dispatcher; reverting means deleting the `surface` field and the grouped `--help`, leaving the flat
CLI exactly as it is today. Because nothing is removed and the registry stays the single source of
truth, there is no data migration to unwind and no external contract to break.

## References

- `lib/cli-commands.mjs` (CLI_COMMANDS, ALL_COMMAND_NAMES, COMMAND_NAMES; `core`/`internal` flags)
- `scripts/audit/00-inventory.mjs` (census: 110 commands, 13 core, 18 internal, 22 lazy-import handlers — verified this session)
- `lib/mcp/server.mjs` (52 tools; 7-tool flat core `CORE_TOOL_NAMES`; `construct_call` long-tail collapse; embedded-contract tools `triage_recommend`, `workflow_invoke`, `capability_describe`, `construct_execution_resolve`, `model_resolve`, `orchestration_run`/`orchestration_status`)
- `lib/tty-prompts.mjs`, `lib/server/` (the embryonic TUI and dashboard surfaces)
- `docs/audit/tooling-scorecard.md` (interactive/visual layer flagged as the open design question)
- `docs/research/2026-06-construct-audit/80-synthesis.md` (item 2 — keep the always-on agent surface tiny, load the rest by trigger)
- ADR-0001 (zero-npm-core registry dispatcher — the substrate)
- ADR-0022 (orchestration daemon API — engine owns orchestration, hosts are thin clients)
- ADR-0033 (platform capability registry — the declarative, non-destructive precedent)
- ADR-0038 / ADR-0032 (small-surface discipline applied to prompts/models)
