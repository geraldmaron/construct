# Profile lifecycle

Profiles describe how Construct shapes itself for a given org. The default is `rnd`. The other curated profiles are `operations`, `creative`, `research`. Anything else is a custom profile.

A worker profile record — a curated `specialists/org/worker-profiles/<id>.json` file, loaded and enriched by `lib/scopes/loader.mjs`/`enrich.mjs` — configures a worker's runtime, model capability tier, skill emphasis, and the flows or procedures it is oriented toward. A worker profile selects flows and skill emphasis over the fixed roster; it is not a separate organizational identity.

Curated worker profiles live in `specialists/org/worker-profiles/`. They declare intake taxonomy, doc templates, tone, and skill emphasis. `construct.config.json`'s `scope` field selects the active profile (default `rnd`).

A role genuinely absent from the 12-role roster (rare) is discovered as a **skill-emphasis worksheet** (`skill-emphasis/<role>.md` under a scope draft, stage 1), not a standalone persona identity file — see `docs/guides/concepts/persona-research.md`. The worksheet feeds stage 3 and the eventual `construct specialist create <id> --custom --skills=...` call (`docs/guides/cookbook/custom-specialists-and-teams.md`); it is never a first-class identity record on its own.

## Teams and groups

`specialists/org/teams/` and `specialists/org/groups/` are not authored per-profile — curated scopes derive them from the shared org at load time (`lib/scopes/enrich.mjs`). They are current, load-bearing inputs to the live orchestration runtime (`lib/orchestration/routing-tables.mjs`, `lib/orchestration/gates.mjs`, `lib/orchestration/recruiter.mjs` all resolve `registry.teams`) and to the no-code org-authoring API (`lib/registry/org-api.mjs`, `lib/registry/custom-scaffold.mjs`) — a custom specialist cannot even be created without an existing team id (`docs/guides/cookbook/custom-specialists-and-teams.md` § Required fields, `team-no-owner-specialist` validation). Retiring them as fixed structure is gated on parallelism becoming a Plan property (directive §10, target-model.md concept 7) — a store that does not exist yet — plus a zero-hit grep for team/group references across every live flow. Neither precondition holds today; do not delete `specialists/org/teams/` or `specialists/org/groups/` ahead of that.

This page describes how a new profile gets made, how it ships, how it stays honest after it ships, and how it gets retired. The shape mirrors how mature scaffolding systems (Backstage software templates, Cookiecutter, Yeoman) handle template lifecycles, plus the standard user-research loop. Profiles are not a JSON exercise; they are a research artifact — but with a 12-role fixed roster, that research is about *which flows and skills this org's work loop emphasizes*, not about inventing new roles or departments.

## Stages

```
draft → active (curated or custom) → archived
                  ↑
            health monitoring
```

A worker profile that never had a draft phase, or that skipped validation, is not legitimate. Drop-in JSON is allowed for experimentation, but a profile that lands in `specialists/org/worker-profiles/` should have followed the discipline below.

## Stage 1: discovery (cx-researcher)

Characterize the people, the work, and the outputs of the target org. `cx-researcher` absorbed `cx-ux-researcher`'s user-research duties in the rf26.11 roster consolidation.

Required answers:

- Which of the 12 core roles (architect, reviewer, engineer, debugger, qa, security, operations, product-manager, data-analyst, designer, researcher, orchestrator) are primary for this org, and which are rarely if ever needed
- Dominant work loop in 5 to 8 stages
- Recurring signals that enter the loop
- Canonical output artifacts
- At least 2 primary sources (interviews, internal docs, job specs)

Evidence belongs in the requirements brief at `.construct/scopes/draft-<id>/requirements.md`. Without evidence, this is opinion, not research.

## Stage 2: framing (cx-product-manager)

Turn the discovery into an intake taxonomy and a stage sequence.

- Propose up to 24 intake types. Each must be distinct, observable, and routable to a primary owner among the 12 core roles.
- Propose up to 12 stages. Order matters. Each stage answers "what changed?".
- For each intake type: primary owner role and recommended chain (max 3 hops).
- For each stage: dominant artifact.

Cap rationale lives in `docs/guides/concepts/persona-research.md`.

Acceptance: a real signal classifies into a single intake type with confidence above 0.6 against the draft table.

## Stage 3: skill emphasis (cx-architect)

Pick the flows and skill bundles this profile emphasizes from the shared registry — not a new role set. There is no department or role invention here: the 12-role roster is fixed system-wide (`lib/scopes/enrich.mjs` derives `roles`/`teams` for every scope from `specialists/org` at load time, not from the scope file).

- For each doc template the profile ships, confirm it names an owning role among the 12.
- Set `defaultSkills` (skill ids under `skills/`) to the handful this org's work loop leans on most. These become the profile's baseline skill entitlement (`lib/skills/router.mjs`), layered on top of whatever an individual specialist already carries.
- Set `researchProfiles` per intake type (`external`, `user`, `codebase`, `market`, `compliance`) and `toneDefaults` per doc template.
- If — rarely — this org genuinely needs a role absent from the 12, that is a new custom specialist authored through the construct-rf26.13 config layer (`construct specialist create <id> --custom`, see `docs/guides/cookbook/custom-specialists-and-teams.md`), not a role invented inline in the scope file.

Acceptance: every `defaultSkills` entry resolves to a real file under `skills/`; every doc template maps to an owning role among the 12.

## Stage 4: validation (cx-reviewer)

Prove the draft works on real signals before promotion. `cx-reviewer` absorbed `cx-evaluator`'s scoring-rigor duties in the rf26.11 roster consolidation.

- Run the classifier against at least 5 representative signals.
- Score precision, recall, and median routing confidence.

Acceptance: precision and recall both >= 0.7, no `unknown` for the canonical signals.

## Stage 5: promotion (operator decision)

Move the draft into the active catalog, or leave it as a durable custom profile.

Curated path:

1. Hand-edit `specialists/org/worker-profiles/<id>.json` from the draft.
2. Open a PR. Run `npm run lint:scopes`.
3. Validation acceptance must already be met. The PR description cites it.

Custom path (named, reusable) — reuses the construct-rf26.13 config layer instead of a scope-specific mechanism:

1. Copy the draft `scope.json` to `<project>/.construct/org/worker-profiles/<id>.json` (project tier, git-tracked, highest precedence) or `~/.construct/org/worker-profiles/<id>.json` (user tier, shared across every project on the machine).
2. `construct scope set <id>` switches to it exactly like a curated scope; a project-tier file with the same id as a curated one overrides it field-by-field.

Custom path (anonymous, one-off) — the pre-rf26.13 escape hatch, still supported:

1. Copy the draft `scope.json` to `<project>/.construct/scope.json` with `"custom": true`. Picked up automatically by the loader; there is no id to set.

## Stage 6: health monitoring (cx-reviewer)

Keep the profile honest after it ships. `cx-reviewer` also absorbed `cx-trace-reviewer`'s fleet-level trace-anomaly duties.

```bash
construct scope health <id> [--days=30]
```

Reports per-profile observation counts and per-role outcome rates. Any role with success-rate < 0.5 across 10 or more runs is a signal to revisit. Health data is the input for the next profile revision; do not edit a profile without a health report first.

## Stage 7: archive (cx-operations + operator)

Retire a profile cleanly without losing the learning. `cx-operations` absorbed `cx-docs-keeper`'s record-keeping duties in the rf26.11 roster consolidation.

```bash
construct scope archive <id> --reason="..."
```

Moves `specialists/org/worker-profiles/<id>.json` and its intake table into `archive/scopes/<id>/`, alongside an `archive-note.md` that records why. Observations and outcomes recorded under the archived profile remain in `.construct/observations/` and `.construct/outcomes/`. They are durable evidence.

Restore: move the files back to their original paths and run `npm run lint:scopes`.

## CLI

```bash
construct scope show                        # active profile
construct scope list                        # curated catalog
construct scope set <id>                    # switch curated or named custom
construct scope create <id> --display="..." # scaffold a draft + requirements brief
construct scope drafts                      # in-progress drafts
construct scope health <id> [--days=N]      # observation + outcome rollup
construct scope archive <id> --reason="..." # retire a curated profile
```

## Files involved

- `specialists/org/worker-profiles/<id>.json` — curated worker profile, source of truth (builtin tier)
- `~/.construct/org/worker-profiles/<id>.json` — named custom worker profile, user tier
- `<project>/.construct/org/worker-profiles/<id>.json` — named custom worker profile, project tier, highest precedence
- `<project>/.construct/scope.json` — anonymous custom scope (pre-rf26.13 escape hatch, still supported)
- `schemas/scope.schema.json` — shape validator
- `lib/intake/tables/<id>.mjs` — per-profile classification table
- `.construct/scopes/draft-<id>/` — draft + requirements brief
- `archive/scopes/<id>/` — archived profile + archive-note

## Why this discipline

Without it, every new profile is a guess. Construct's whole point is that the system gets smarter over time. A profile that was not validated against real signals will route them wrong, generate the wrong artifacts, and accumulate bad observations that degrade the classifier. The discipline above is the cheapest way to keep that from happening.
