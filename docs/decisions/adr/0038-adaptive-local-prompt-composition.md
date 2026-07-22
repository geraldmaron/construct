# ADR-0038: Adaptive Local-Model Prompt Composition — Capability-Tiered Sections, Not a Variant

- **Date**: 2026-06-17
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none
- **Status note (2026-07-20, construct-72gqn.34)**: Operating-profile tiering decision recorded in [Operating profile tiering](#operating-profile-tiering-construct-72gqn34) below. Axis is measured capability class/tier, not Anthropic model family (Fable/Opus/Sonnet/Haiku). Implementation scope is construct-72gqn.35.

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

## Operating profile tiering (construct-72gqn.34)

Investigation bead for Fable5 wave 5. Read-only inventory and decision record; implementation is
construct-72gqn.35 (`slug:model-tier-profiles`).

### Inventory (re-grep 2026-07-20, branch `feat/workspace-control-plane`)

**Prompt-composition layer (model-profile fragment budgets):**

| Location | Finding |
|---|---|
| `registry/worker-profiles/prompts/**` | Zero matches for legacy literals (`gpt-3.5`, `gpt-4`, `claude-2`, `claude-instant`, `davinci`, `palm`, `opus-3`, `sonnet-3`, `haiku-3`). |
| `lib/prompt-composer.mjs` | Zero legacy literals. Consumes `operatingProfileIdFromProfile(resolveExecutionCapabilityProfile(...))` and `MODEL_OPERATING_PROFILES[...]` at lines 25-31, 204-208, 239-270. |
| `lib/model-router.mjs` | `MODEL_OPERATING_PROFILES` (`balanced`, `small`) at lines 63-88; `inferSmallModelProfile` name/size heuristic at lines 102-115; `resolveModelOperatingProfile` at lines 121-131. Haiku substring at line 112 is selection logic, not prompt scaffolding. |
| `lib/models/execution-capability-profile.mjs` | Header (lines 1-24) tags router heuristics as `compatibility_fallback`; `operatingProfileId` field at lines 134-135, 151-152. |

**Outside prompt composition (routing, telemetry, pricing; not removable prompt scaffolding):**

| Location | Finding |
|---|---|
| `lib/models/provider-poll.mjs:127` | `davinci` in `OPENAI_NON_CHAT` catalog filter (routing). |
| `lib/provider-capabilities-openai.js:31-34` | `gpt-3.5` / `gpt-4` context-window heuristics (provider metadata). |
| `lib/model-router.mjs:204-226, 284-285, 580-581` | Tier default catalog ids including `claude-opus`, `claude-sonnet`, `claude-haiku` (model routing, not composition). |
| `lib/certification/`, `lib/telemetry/`, `lib/orchestration/` | Miscellaneous model-id references for certification fixtures, pricing, and comments; none author prompt fragments. |

**Premise correction:** The org-audit brief assumed stale per-model scaffolding in the prompt/composer layer was harming current models. The 2026-07-20 grep confirms that premise is **not evidenced**. The actual gap is the opposite: only two operating profiles (`balanced`, `small`) with a name/size regex fallback, so every hosted frontier model (Sonnet, Opus, future Fable-tier) shares identical composition budgets.

### Decision: capability class/tier, not model family

**Do not add Fable/Opus/Sonnet/Haiku family-keyed operating profiles.**

Fable, Opus, Sonnet, and Haiku are vendor marketing tiers, not measured execution capability. Distinct profiles keyed to those names would duplicate the anti-pattern this ADR and the construct-6zga program already reject:

- `lib/models/behavior-matrix.mjs:6-9` derives capability class from transport plus measured signals, **not vendor name**.
- `lib/models/execution-policy.mjs:12-14` (construct-6zga.1.2 AC4) branches only on `capabilityClass`, transport, and capability values, never on a model-name string.
- ADR-0038 already keys persona section inclusion to `resolveCapabilityTier` (capability), not family.

**Extend `MODEL_OPERATING_PROFILES` selection through `ExecutionCapabilityProfile`, keyed by measured capability class and tier evidence.**

| Capability signal | Operating profile (initial mapping for construct-72gqn.35) |
|---|---|
| `capabilityClass` `local-constrained` or `unknown` | `small` |
| `capabilityClass` `local-capable` | `balanced` (same token fields; persona tier still handled by `resolveCapabilityTier`) |
| `capabilityClass` `hosted-direct` or `hosted-routed` | `balanced` |
| Operator override (`CONSTRUCT_MODEL_PROFILE` / `constructModelProfile`) | Explicit profile id (unchanged) |
| No measured evidence yet | Existing `inferSmallModelProfile` regex remains as `compatibility_fallback` until the capability-adaptive selector covers equivalent cases |

Haiku-like hosted models that need tighter budgets should land in `small` because measured class or probe evidence says constrained, not because the id string contains `haiku`. Future Fable-tier models that share `hosted-direct` class with Sonnet/Opus stay on `balanced` unless live probe or provider metadata proves a different capability envelope.

A third named profile (for example `generous`) is **deferred** until measured evidence shows `balanced` systematically under-serves a capability class. Do not pre-create family slots.

**Profile field shape:** Keep the existing record shape (`maxPromptTokens`, per-fragment token budgets, `retrievalFirst`, `preferCompressedRoleGuidance`). No new fields until a measured gap requires them. Any extension adjusts values per capability class, not per vendor family.

**Retire `inferSmallModelProfile` only in construct-72gqn.35** when `ExecutionCapabilityProfile`-driven selection covers every case the regex currently handles, with equal or better evidence tagging (`compatibility_fallback` replaced by `provider_metadata`, `live_probe`, or `operator_override`). Do not delete the regex in this investigation bead.

### Relationship to construct-6zga.1.2 (capability-adaptive policy)

**Status:** closed (2026-06-22). **Relationship:** orthogonal and complementary, not subsuming.

| Layer | Owner | What it controls |
|---|---|---|
| Persona section tier | `resolveCapabilityTier` (`lib/model-router.mjs:144-151`) | Which `##` persona sections emit (`floor` / `mid` / `full`). |
| Operating profile (this decision) | `resolveModelOperatingProfile` via `ExecutionCapabilityProfile.operatingProfileId` | Prompt-composer fragment token budgets and pruning flags (`lib/prompt-composer.mjs:204-270`). |
| Per-turn execution policy | `compileExecutionPolicy` (`lib/models/execution-policy.mjs`) | Tool-schema cap, tool iterations, output budget, visible thinking, caching (construct-6zga.1.2). |

construct-6zga.1.2 **does not** replace operating-profile selection. It **reads** `operatingProfileIdFromProfile` (`lib/models/execution-policy.mjs:181-183`) but compiles tool/output controls from `capabilityClass`. Both layers must stay name-driven-free.

`lib/models/execution-capability-profile.mjs:15-22` anticipates construct-6zga.1.2 superseding the **heuristic** for measured fields. construct-72gqn.35 applies the same supersession pattern to `operatingProfileId`, wiring selection off `capabilityClass`, `capabilityTier`, probe verdict, and provider metadata instead of `inferSmallModelProfile` alone.

### Unblocks construct-72gqn.35

Implementation bead scope is fixed: capability-class/tier-keyed operating profiles driving prompt composition; no family-keyed tiers; retire `inferSmallModelProfile` only when the investigation cleared it; functional test plus `construct doctor` as completion gates.

## References

- `lib/persona-sections.mjs`, `lib/model-router.mjs` (`resolveCapabilityTier`, `inferSmallModelProfile`,
  `MODEL_OPERATING_PROFILES`, `resolveModelOperatingProfile`), `lib/models/execution-capability-profile.mjs`,
  `lib/models/execution-policy.mjs`, `scripts/sync-specialists.mjs` (`buildPrompt`, `syncOpencode`),
  `lib/prompt-composer.mjs`.
- ADR-0032 (small-model context methodology), ADR-0034 (local-vs-cloud detected not declared),
  ADR-0037 (static-budget gap recorded for later), ADR-0002 (platform-native orchestration).
- Liu et al., "Lost in the Middle" (arXiv:2307.03172); aider architect/editor; LMSYS RouteLLM;
  Ollama context-length / OpenAI-compatibility docs (num_ctx via Modelfile).
