# ADR-0047: Specialist vs flavor taxonomy

- **Date**: 2026-06-26
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), cx-architect
- **Amends**: [ADR-0013](./0013-skills-on-disk-layout.md) role overlay naming only

## Problem

Construct uses two overlapping mechanisms to specialize agent behavior:

1. **Specialists** (`cx-*` in `specialists/org/specialists/`) — distinct dispatch targets with fences, skill packs, and handoff contracts.
2. **Role overlays** (`skills/roles/*.md`) — anti-pattern and methodology files injected at prompt compose time or via `get_skill`.

Before this ADR, naming and wiring were inconsistent:

| Pattern | Example | Issue |
|---------|---------|-------|
| Flavor under parent role | `engineer.ai` → `cx-ai-engineer` | Split specialist used a sibling role prefix; prompt composer only mapped `engineer` |
| Flavor on wrong specialist | `product-manager.business-strategy` → `cx-business-strategist` | Strategy work lived under PM namespace |
| Shared operator namespace | `operator.sre` on `cx-sre` | Ops squad roles use distinct specialist names (`sre`, `release-manager`, …) |
| Routing ignored splits | AI/platform keywords still dispatched `cx-engineer` | Dedicated `cx-ai-engineer` / `cx-platform-engineer` were rarely selected |

A reader could not predict whether to add a new `cx-*` file or a new `skills/roles/<parent>.<flavor>.md` file.

## Context

- ADR-0046 modularized org data; scopes (`specialists/org/scopes/`) now carry intake/tone only — the org is shared.
- 29 specialists and 53 role overlay files exist (2026-06-26 inventory).
- Prompt injection is centralized in `lib/prompt-composer.js`; routing in `lib/orchestration-policy.mjs`.
- Flavor caps and validation live in `lib/flavors/loader.mjs` (6 flavors per role per scope).

## Decision

### 1. Naming contract

**Role overlay id = specialist `name`, optionally suffixed by variant.**

| File | `role` frontmatter | Applies to |
|------|-------------------|------------|
| `skills/roles/engineer.md` | `engineer` | `cx-engineer` only |
| `skills/roles/ai-engineer.md` | `ai-engineer` | `cx-ai-engineer` |
| `skills/roles/architect.platform.md` | `architect.platform` | `cx-architect` (flavor on generalist) |
| `skills/roles/data-engineer.pipeline.md` | `data-engineer.pipeline` | `cx-data-engineer` |

Rules:

- **Split specialist** → base file `{name}.md`. Optional sub-flavors `{name}.{variant}.md`.
- **Generalist specialist** → base `{name}.md` plus flavors `{name}.{variant}.md` selected by classifiers.
- `applies_to` lists only specialists that should load that overlay. No cross-namespace wiring (e.g. no PM flavor on business strategist).
- `inherits` points to the parent role file when the overlay extends a base (e.g. `ai-engineer` inherits `engineer`).

### 2. When to split vs flavor

| Split into new `cx-*` specialist when | Use flavor overlay when |
|---------------------------------------|-------------------------|
| Distinct fence paths or approval gates | Same fence; task-specific methodology |
| Distinct skill pack domain | Same skills; different failure modes |
| Separate squad charter / escalation | Same squad; workspace or keyword variant |
| Separate handoff contract envelope | Classifier selects overlay on one dispatch target |

**Examples after migration:**

- **Generalist + flavors**: `cx-architect` + `architect.{platform,ai-systems,data,…}`; `cx-product-manager` + `product-manager.{platform,growth,…}`; `cx-qa` + `qa.{web-ui,ai-eval,…}`.
- **Split specialists (base file only)**: `cx-ai-engineer`, `cx-platform-engineer`, `cx-business-strategist`, `cx-sre`, `cx-devil-advocate`, `cx-explorer`.
- **Split + sub-flavors**: `cx-data-engineer` + `data-engineer.{pipeline,warehouse,vector-retrieval}`.

### 3. Runtime bindings

`lib/roles/flavor-bindings.mjs` is the single map from specialist `name` → `{ classifierKey, rolePrefix, specialistId, baseOnly? }`.

- `classifyRoleFlavors()` keys must match `classifierKey` values.
- Split engineering classifiers (`aiEngineer`, `platformEngineer`) emit `'core'` to load the base overlay file.
- `selectSpecialists()` replaces `cx-engineer` with the split specialist when AI/platform/data engineering keywords match.
- `formatOverlaySelection()` resolves overlay ids through the same bindings (fixes prior `dataAnalyst.experiment` typo).

### 4. Renames executed (no backwards-compat aliases)

| Old path | New path |
|----------|----------|
| `engineer.ai.md` | `ai-engineer.md` |
| `engineer.platform.md` | `platform-engineer.md` |
| `engineer.data.md` | `data-engineer.md` |
| `product-manager.business-strategy.md` | `business-strategist.md` |
| `operator.md` | `operations.md` |
| `operator.sre.md` | `sre.md` |
| `operator.release.md` | `release-manager.md` |
| `operator.docs.md` | `docs-keeper.md` |
| `reviewer.{devil-advocate,evaluator,trace}.md` | `{devil-advocate,evaluator,trace-reviewer}.md` |
| `researcher.{ux,explorer}.md` | `{ux-researcher,explorer}.md` |
| `qa.test-automation.md` | `test-automation.md` |

## Rationale

Aligning file names with specialist `name` fields removes the three-way mismatch between team `roles[]`, `applies_to`, and `AGENT_FLAVOR_MAP`. Split specialists get routing and prompt injection through one binding table. Generalist specialists keep flavor overlays where classifiers add task nuance without multiplying fences.

Rejected alternatives:

- **Keep cross-wired flavors** (`engineer.ai` on `cx-ai-engineer`) — rejected; requires mental translation and broke prompt composer for split agents.
- **Flavors only, no split specialists** — rejected; AI/platform/data engineers have distinct fences and skill packs that justify separate dispatch targets.
- **Alias layer / rewrites** — rejected per product direction; rename in place.

## Consequences

- **Positive**: Predictable authoring; split specialists receive overlays; overlay trace lines name correct role ids.
- **Negative**: One-time rename across prompts, tests, certification inventory, and docs references.
- **Neutral**: Generalist flavor cap (6 per role per scope) unchanged; split bases count as roles under their own prefix.

## Reversibility

Two-way door for individual renames; one-way for the binding-table contract once downstream hosts depend on it. Revisit if a third pattern (e.g. dynamic runtime-generated overlays) appears.

## References

- [docs/guides/concepts/teams.md](../../guides/concepts/teams.md) — squad roles and flavor section
- `lib/roles/flavor-bindings.mjs` — binding source
- `tests/flavor-bindings.test.mjs` — binding + file existence gate
- ADR-0046 — modular org layout
