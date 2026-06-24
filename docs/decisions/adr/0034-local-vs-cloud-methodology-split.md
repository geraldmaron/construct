# ADR-0034: Local-vs-Cloud Methodology — Detected, Not Declared

- **Date**: 2026-06-10
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none

## Problem

Local models and hosted models have genuinely different operating envelopes: a small local model
needs a trimmed tool surface and a real context window, while a hosted model wants the full surface.
The question this ADR settles is whether Construct should make that divergence an explicit, user-set
**mode** — a `modelStrategy: local | cloud | hybrid | auto` knob in project config that the sync and
runtime paths branch on — or keep it **detected** from signals already present in the config.

Choosing wrong is costly either way. A declared mode the system does not actually need is a config
surface users must learn, set, and keep correct, and a second source of truth that can disagree with
the model they actually selected. A missing mode, conversely, leaves the system guessing when the
signals are ambiguous.

## Context

Two pieces of this audit's tranche changed the baseline the decision rests on:

- The heavy-external MCP trim became **intent-driven** (ADR-0032, revised): it keys off the config's
  own default model, with an explicit `--local-surface=on|off|auto` lever for the one ambiguous case
  (a user who selects a local model at runtime, leaving the config default unset). See
  `lib/mcp/tool-budget.mjs` `decideTrim`.
- Capability honesty became **durable and consumed**: probe verdicts persist and sync/doctor read
  them, so a model that cannot do agentic work is flagged regardless of any declared mode.

External precedent exists for a declared split — Goose's lead/worker model selection, Cline's
"compact prompt" toggle (`docs/notes/research/2026-06-construct-audit/10-open-agents.md`). But those tools
expose the knob because they have no equivalent of Construct's intent signal; they cannot infer the
user's model choice from a host config the way Construct reads `opencode.json`.

## Decision

Do not add a `modelStrategy` mode. Keep the local-vs-cloud divergence **detected** from the config's
default model, with `--local-surface` (and `CONSTRUCT_LOCAL_SURFACE`) as the single explicit override
for the ambiguous runtime-picker case. The divergence remains real and is allowed — it is simply
driven by the model the user already chose, not by a second declared axis.

## Rationale

After the intent-driven trim and persisted capability honesty landed, no scenario remained where a
declared mode would decide differently from the model the config already names: a local default trims
and provisions, a cloud default does not, and the only genuinely unobservable case (runtime picker,
no default set) is covered by one explicit flag. A `modelStrategy` knob would therefore restate
information the config already carries, adding a surface to learn and a second source of truth that
can drift from the selected model. The precedent tools expose the knob precisely because they lack
Construct's config-level intent signal — that difference makes their choice the wrong analogy here.

## Rejected alternatives

- **A `modelStrategy: local | cloud | hybrid | auto` field in project config.** Rejected: with trim
  intent-driven and capability honesty persisted, it duplicates the default-model signal and creates a
  drift surface (the mode says "cloud" while the selected model is local, or vice-versa) with no
  decision it uniquely resolves. It is reconsidered only if a concrete case shows detection picking
  wrong — that case would be the evidence this ADR currently lacks.
- **Per-profile local/cloud variants.** Rejected: profiles are role/persona-shaped; model strategy is
  orthogonal to persona, so encoding it in profiles would entangle two independent axes and multiply
  the profile catalog.

## Consequences

- Users configure one thing — the model — and the surface, provisioning, and capability warnings
  follow from it; the explicit lever exists only for the runtime-picker edge.
- There is no second source of truth to keep in sync with the selected model.
- If a future case demonstrably needs an explicit declared strategy, this decision is revisited with
  that case as the forcing evidence; the `--local-surface` lever is the incremental step that would
  precede a full mode.

## Reversibility

Two-way door. Nothing here forecloses a later `modelStrategy` field; it declines to add one now. The
`--local-surface` flag is the smaller, already-shipped increment, so a future mode would generalize an
existing lever rather than start from nothing.

## References

- `docs/notes/research/2026-06-construct-audit/80-synthesis.md` (items 3, 6)
- `docs/notes/research/2026-06-construct-audit/10-open-agents.md` (Goose lead/worker, Cline compact prompt)
- ADR-0032 (small-model methodology — intent-driven trim, persisted capability honesty)
- ADR-0033 (platform capability registry)
