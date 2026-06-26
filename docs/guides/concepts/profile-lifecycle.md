# Profile lifecycle

Profiles describe how Construct shapes itself for a given org. The default is `rnd`. The other curated profiles are `operations`, `creative`, `research`. Anything else is a custom profile, which lives in `.cx/profile.json` with `custom: true`.

Each curated profile may declare a `teams[]` collection alongside `departments[]`. Teams carry explicit decision rights, forbidden decisions, and escalation paths. At runtime, `lib/profiles/teams.mjs` resolves profile teams for headhunt (`construct headhunt`) and orchestration routing when `construct.config.json` selects a profile with teams (for example `operations` maps incident work to `reliability-team`). The unified registry group ids (`engineering-group`, etc.) remain the default for the `rnd` profile and for registry validation; profile teams are an overlay, not a second registry file.

This page describes how a new profile gets made, how it ships, how it stays honest after it ships, and how it gets retired. The shape mirrors how mature scaffolding systems (Backstage software templates, Cookiecutter, Yeoman) handle template lifecycles, plus the standard user-research loop. Profiles are not a JSON exercise; they are a research artifact.

## Stages

```
draft → active (curated or custom) → archived
                  ↑
            health monitoring
```

A profile that never had a draft phase, or that skipped validation, is not legitimate. Drop-in JSON is allowed for experimentation, but a profile that lands in `profiles/` should have followed the discipline below.

## Stage 1: discovery (cx-ux-researcher)

Characterize the people, the work, and the outputs of the target org.

Required answers:

- 4 to 8 typical roles with one-line responsibilities
- Dominant work loop in 5 to 8 stages
- Recurring signals that enter the loop
- Canonical output artifacts
- At least 2 primary sources (interviews, internal docs, job specs)

Evidence belongs in the requirements brief at `.cx/profiles/draft-<id>/requirements.md`. Without evidence, this is opinion, not research.

## Stage 2: framing (cx-product-manager)

Turn the discovery into an intake taxonomy and a stage sequence.

- Propose up to 24 intake types. Each must be distinct, observable, and routable to a primary owner.
- Propose up to 12 stages. Order matters. Each stage answers "what changed?".
- For each intake type: primary owner role and recommended chain (max 3 hops).
- For each stage: dominant artifact.

Cap rationale lives in `docs/guides/concepts/persona-research.md`.

Acceptance: a real signal classifies into a single intake type with confidence above 0.6 against the draft table.

## Stage 3: architecture (cx-architect)

Define the role set and how it connects to the existing cx-* registry.

- Up to 80 role ids, grouped into up to 12 departments with up to 20 roles per department. For each role: `reuse-existing` (name the cx-* agent), `create-new` (specify scope), or `compose-overlay` (which base + which flavor).
- Each department gets a one-paragraph charter (>= 20 chars). What it owns. What it does not own. Who it hands off to.
- Identify ambiguous handoffs. Name the orchestrator role.
- Validate against the per-role flavor cap of 6.

Acceptance: every declared role either exists in `specialists/registry.json` or has a written scope statement.

## Stage 4: validation (cx-evaluator)

Prove the draft works on real signals before promotion.

- Run the classifier against at least 5 representative signals.
- Score precision, recall, and median routing confidence.

Acceptance: precision and recall both >= 0.7, no `unknown` for the canonical signals.

## Stage 5: promotion (operator decision)

Move the draft into the active catalog.

Curated path:

1. Hand-edit `profiles/<id>.json` from the draft.
2. Open a PR. Run `npm run lint:profiles`.
3. Validation acceptance must already be met. The PR description cites it.

Custom path:

1. Copy `profile.json` to `<project>/.cx/profile.json` with `"custom": true`.
2. Use `construct profile set <id>` only for switching among curated; custom is picked up automatically by the loader.

## Stage 6: health monitoring (cx-evaluator + cx-trace-reviewer)

Keep the profile honest after it ships.

```bash
construct profile health <id> [--days=30]
```

Reports per-profile observation counts and per-role outcome rates. Any role with success-rate < 0.5 across 10 or more runs is a signal to revisit. Health data is the input for the next profile revision; do not edit a profile without a health report first.

## Stage 7: archive (cx-docs-keeper + operator)

Retire a profile cleanly without losing the learning.

```bash
construct profile archive <id> --reason="..."
```

Moves `profiles/<id>.json` and its intake table into `archive/profiles/<id>/`, alongside an `archive-note.md` that records why. Observations and outcomes recorded under the archived profile remain in `.cx/observations/` and `.cx/outcomes/`. They are durable evidence.

Restore: move the files back to their original paths and run `npm run lint:profiles`.

## CLI

```bash
construct profile show                        # active profile
construct profile list                        # curated catalog
construct profile set <id>                    # switch curated
construct profile create <id> --display="..." # scaffold a draft + requirements brief
construct profile drafts                      # in-progress drafts
construct profile health <id> [--days=N]      # observation + outcome rollup
construct profile archive <id> --reason="..." # retire a curated profile
```

## Files involved

- `profiles/<id>.json`. curated profile, source of truth
- `schemas/profile.schema.json`. shape validator
- `lib/intake/tables/<id>.mjs`. per-profile classification table
- `.cx/profile.json`. user-defined custom profile (escape hatch)
- `.cx/profiles/draft-<id>/`. draft + requirements brief
- `archive/profiles/<id>/`. archived profile + archive-note

## Why this discipline

Without it, every new profile is a guess. Construct's whole point is that the system gets smarter over time. A profile that was not validated against real signals will route them wrong, generate the wrong artifacts, and accumulate bad observations that degrade the classifier. The discipline above is the cheapest way to keep that from happening.
