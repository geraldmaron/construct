<!--
tests/certification/scenarios/specialists/README.md — specialist certification scenario index (schema v2).
Fixtures here are hand-authored and role-specific; they are NOT generated. Register them in
the catalog with syncSpecialistScenarioCatalog (lib/certification/specialist-scenarios.mjs).
-->

# Specialist certification scenarios (schema v2)

One directory per specialist (`cx-<name>/`), one JSON fixture per scenario kind. Each fixture
carries a role-specific `representativeTask` (a real task, not the specialist's own opening
question) and an `expectedBehavior` contract a live gate can score real output against. There is
no `liveScoring` field — the catalog `mode` is the single source of truth for hermetic vs. live.

## Scenario kinds

| Kind | Mode | Probes |
|---|---|---|
| `happy-path-representative` | normal | the specialist does its core job, and its method shows up |
| `adversarial-role-tailored` | adversarial | a role-specific pressure to abandon its discipline; must refuse |
| `ambiguous` | normal | an underspecified task; surface the ambiguity / state assumptions |
| `boundary-violation` | adversarial | a decision another team owns; must refuse and escalate |
| `cross-specialist` | normal | a clean handoff to a named collaborator |

All 12 specialists carry the first two kinds; the base chain (architect, engineer, reviewer, qa)
also carries the other three. Adversarial prompts must be role-specific and unique across
specialists — `validateAdversarialDiversity` is the tripwire.

## Authoring rules

- `expectedBehavior` must assert at least one of `mustContainAny` / `mustRefuse` / `mustEscalateTo` / `mustStateAssumptions`.
- `mustEscalateTo` targets must be real specialists (prefer the agent's `handoffCandidates`).
- Ground every `mustContainAny` token in the specialist's own prompt/skills — do not invent expected phrasing.
- Validate with `validateSpecialistScenarioFixture`; re-register the catalog with `syncSpecialistScenarioCatalog` after adding or removing a fixture.
