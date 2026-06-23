# ADR-0038: Adaptive Local-Model Prompt Composition — Capability-Tiered Sections, Not a Variant

- **Date**: 2026-06-17
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none

## Problem

The OpenCode orchestrator prompt is assembled once at sync time and written statically into
`opencode.json`; it is not model-aware. A small local model (7B–30B via Ollama) therefore receives
the same persona a frontier model does. The existing small-model machinery does not reach this path:
`composePrompt` / `MODEL_OPERATING_PROFILES.small` (with its token-budget pruning) runs only on the
Claude Code MCP dispatch path, and `pruneFragments` only drops low-priority *dynamic* fragments — the
persona is a single priority-1 `core` fragment that always passes through whole. So slimming for local
models had no effect on OpenCode at all.

The decision-forcing tension is *how* to size the prompt for a weak model. A hand-authored slim persona
variant duplicates a load-bearing artifact and drifts from the canonical one; a user-selected mode is a
config surface that can disagree with the model actually chosen (the same failure ADR-0034 rejects).
Neither is acceptable for the prompt every local session depends on.

## Context

A measurement reframed the problem. The persona is ~1,819 tokens and its irreducible must-keep floor is
~333 tokens; even an 8k window has ~3,100 tokens of system budget after reserves. So the full persona
*fits* once the cx32k Modelfile variants (which set the real `num_ctx`) are in place. Hard context
overflow — the failure that motivated ADR-0032 — is solved by those variants, not by prompt slimming.

The remaining failure is instruction-following: small models comply with large multi-instruction prompts
worse *even when the prompt fits*, a well-documented degradation (Liu et al., "Lost in the Middle",
arXiv:2307.03172; and the established practice of routing narrow execution to a small model while
reasoning escalates to a larger one — aider's architect/editor split, LMSYS RouteLLM). The binding
constraint is instruction-following capacity, which tracks model size/family and is measured by
`probeAgenticCoherence` (COHERENT/COLLAPSED), **not** the token window.

## Decision

One persona, authored once, renders at a capability tier. Each `## ` section carries an inline
`<!-- cx:prio=N -->` marker (preamble is implicit prio 1); `lib/persona-sections.mjs`
(`parsePersonaSections` / `renderPersonaForTier`) emits only sections at or below a tier — floor
(prio 1, must-keep), mid (prio ≤ 2), full (all). Markers are stripped before emit on every path
(`stripSectionMarkers`, applied in `renderPersonaForTier` and in `composePrompt`'s core fragment), so
they never reach a model.

`resolveCapabilityTier({ model, verdict })` (`lib/model-router.mjs`) maps a model to its tier: cloud →
full (cloud configs are never slimmed); local COLLAPSED → floor; local sized ≥24B → mid; smaller or
unknown local → floor. The tier is keyed to model capability, not window arithmetic — `deriveSystemBudget`
is deliberately *not* introduced, because the window is a ceiling already enforced by the cx-variant.

Hybrid routing is realized as the aider architect/editor split over native subagents. When the fast tier
is local, sync emits a second `construct-local` agent (`mode: subagent`) with a floor/mid prompt, a
tightened tool surface, and a deny-all `task` permission (it spawns nothing). Its model is chosen by
capability and type, not by the generic fast-tier default: `selectLocalEditorModel` takes the best
code-specialized model from the config's *declared* local inventory (smallest in the reliable [7,34]B
band, excluding probe-COLLAPSED models), falling back to the fast tier only when no coder is declared.
This matters because OpenCode exposes no runtime model-selection hook — an agent's model is read from a
static config field — so a routing matrix can only be materialized as one statically-bound agent per
role. The matrix (tier + work-category + probe verdict + installed-coder selection) decides the model;
the per-agent pin is merely how that decision reaches the host. Dynamic per-request selection does run on
the Claude Code / MCP path, where the host allows it.
Its directive instructs it to execute bounded edits and escalate planning/reasoning to `construct`. The
architect (`construct`) is **not** pinned — it runs the user's chosen model. Escalation is prompt-driven,
not a runtime model swap (OpenCode exposes no `chat.model` hook) and not via `orchestration_policy`
(which the editor is denied — small models are unreliable at meta-classification, so we do not depend on
the editor calling a classifier).

This closes the static-budget / native-subagent gap recorded in ADR-0037.

## Rationale

Section priority generalizes the priority mechanism Construct already uses for dynamic fragments down
into the persona body, keeping a single source of truth and zero duplication. Keying inclusion to a
measured capability verdict (not a token budget) targets the actual constraint and follows ADR-0034's
"detected, not declared" principle — no new mode for the user to set. Pinning the editor but not the
architect respects the user's model choice while still giving a cheap local executor.

## Rejected alternatives

- **Hand-authored slim persona variant.** Duplicates the most load-bearing artifact; drifts; binary.
- **User-selected `local`/`cloud` prompt mode.** A config surface that can disagree with the selected
  model (ADR-0034).
- **Window-derived token budget (`deriveSystemBudget`).** Targets overflow, which the cx-variants already
  solve; the measurement showed the full persona fits, so this optimizes the wrong axis.
- **LLM-summarized persona at sync.** Nondeterministic, drift-prone, and a fabrication risk for a
  load-bearing prompt — rejected on the same grounds the no-fabrication rule exists.
- **Reducing the local model's `limit.context` to 8–16k.** `limit.context` correctly matches the
  cx-variant's real `num_ctx`; cutting it would make OpenCode compact mid-window and waste half the
  model's window.
- **Escalation routing inside `orchestration_policy`.** The editor cannot call it; prompt-driven handoff
  is more reliable for small models.

## Consequences

- Cloud and cloud-default configs are byte-unchanged (`construct sync` is a no-op for them; verified).
- Local-default OpenCode configs get a tier-sized orchestrator prompt and, when the fast tier is local,
  a `construct-local` editor that escalates to the architect.
- Personas now carry section priority markers; the prompt word-cap guard strips them (they are not
  emitted), consistent with how it already strips frontmatter.
- A sync-time warn-and-emit advisory nudges toward `construct doctor --probe-local` for an unprobed or
  COLLAPSED local model; it never suppresses emission and auto-suppresses in CI/test/non-TTY.

### Verified in a sterile run (OpenCode 1.15.4 + real Ollama)
- Per-agent `model` is honored for a primary agent (a probe pinned to a third model loaded only that
  model) **and** for a subagent dispatched via `task` (the dispatched `construct-local` ran on its
  pinned model while the primary and `small_model` used a different one). This was the one previously
  unverified assumption.
- OpenCode rejects invoking a `subagent` directly via `--agent` (falls back to the default), confirming
  `construct-local` is dispatch-only.
- OpenCode disables the `task` tool entirely for any *restrictive* task permission map. The editor is
  therefore given a deny-all task map (it spawns nothing) and escalates by **returning** to the
  construct agent that dispatched it — not by dispatching construct. The orchestrator keeps an
  unrestricted task map, so its `task` tool stays available to dispatch `construct-local`.

## Reversibility

High. Removing the markers makes `renderPersonaForTier` treat every section as prio 2 (degrades to
near-full); `resolveCapabilityTier` returning `full` everywhere restores the prior behavior; not emitting
`construct-local` leaves a single agent. No persisted state or migration.

## References

- `lib/persona-sections.mjs`, `lib/model-router.mjs` (`resolveCapabilityTier`, `inferSmallModelProfile`),
  `scripts/sync-specialists.mjs` (`buildPrompt`, `syncOpencode`), `lib/prompt-composer.js`.
- ADR-0032 (small-model context methodology), ADR-0034 (local-vs-cloud detected not declared),
  ADR-0037 (static-budget gap recorded for later), ADR-0002 (platform-native orchestration).
- Liu et al., "Lost in the Middle" (arXiv:2307.03172); aider architect/editor; LMSYS RouteLLM;
  Ollama context-length / OpenAI-compatibility docs (num_ctx via Modelfile).
