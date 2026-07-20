# ADR-0095: Certified prompt versions gate releases

- **Date**: 2026-07-20
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-72gqn.40`

## Problem

Construct already runs a release-candidate certification gate (`lib/certification/rc-gate.mjs`) that checks capability freshness, hermetic scenarios, and live evidence tiers. That gate does not tie a composed Worker Profile prompt to a certified version. A role-flavor overlay, core prompt edit, or operating-profile-driven model-profile fragment can change specialist behavior without forcing re-certification before release.

## Context

- `lib/prompt-composer.mjs` assembles static fragments (`core`, `role-flavor`, `model-profile`) plus runtime-only fragments (task packet, learned patterns, context digest, host constraints).
- Worker Profile certification scenarios live under `tests/certification/scenarios/worker-profiles/` and persist runs in `.construct/certification/runs/`.
- `construct certify gate` is already part of `npm run release:check` via `package.json`.
- Hard dependencies `construct-72gqn.33` (prompt-layer precedence) and `construct-72gqn.37` (eval corpus contract) are closed; this bead computes hashes directly from `composePrompt` output rather than waiting on prompt-compile-graph provenance.

## Decision

1. **Define a certified prompt version** as a sha256 hash over the canonical static fragment set for each `(workerProfileId, operatingProfileId)` pair, where `operatingProfileId` is one of `balanced` or `small` from `MODEL_OPERATING_PROFILES`.
2. **Persist records** additively in `.construct/certification/prompt-versions.json` via `lib/certification/store.mjs`.
3. **Extend `runReleaseCandidateGate`** to call `evaluatePromptVersionGate` from `lib/certification/prompt-versions.mjs`:
   - first run bootstraps baseline hashes (does not hard-fail releases with no history);
   - later runs compare live hashes to stored hashes;
   - when a hash drifts, require a passing worker-profile certification run recorded after the prior `certifiedAt` timestamp before the gate passes and the stored hash is updated.
4. **Reuse existing certification scoring**; do not introduce a parallel prompt-scoring engine.

## Ownership boundary

| Concern | Owner |
|---|---|
| Fragment assembly, canonical hash inputs, pair enumeration, bootstrap policy | Construct (`lib/prompt-composer.mjs`, `lib/certification/prompt-versions.mjs`) |
| Scenario execution, verdict derivation, run persistence | Construct certification engine (`lib/certification/runner.mjs`, `lib/certification/store.mjs`) |
| Release orchestration wiring | Construct CLI (`construct certify gate`, `npm run release:check`) |
| External model/provider behavior during live scenarios | Provider adapters (unchanged; live tiers remain opt-in) |

## Rejected alternatives

- **Re-certify every specialist on every release** — rejected as cost-prohibitive; would be skipped in practice.
- **Git diff file watching without composition awareness** — rejected; misses indirect fragment changes through registry and overlay resolution.
- **Hash only the composed `system` string** — rejected; mixes static and runtime fragments unless carefully filtered; explicit static fragment typing is clearer.

## Consequences

- Positive: silent prompt-fragment regressions surface in `construct certify gate` before tag/publish; unchanged prompts reuse prior certification evidence.
- Negative: first bootstrap writes `.construct/certification/prompt-versions.json`; operators must run worker-profile scenarios after prompt edits.
- Bootstrap: releases with no prior record establish baseline hashes on the first gate run instead of failing.

## Reversibility

Revert the wiring commit and delete `prompt-versions.json` if needed. Stored records are additive evidence, not blocking state once the gate is removed. Rollback restores the pre-existing RC gate sequence without data migration.
