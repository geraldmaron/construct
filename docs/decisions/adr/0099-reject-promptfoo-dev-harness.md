# ADR-0099: Reject promptfoo as optional dev certification harness

- **Date**: 2026-07-20
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-72gqn.38`

## Problem

Contributors evaluating external eval tooling had no governed position on adopting promptfoo alongside `lib/certification/`. ADR-0001 zero-npm-core and the existing certification engine already cover scenario execution, evidence tiers, RC gates, and hermetic/live opt-in controls.

## Context

- `lib/certification/` (36 modules at decision time) owns scenario catalogs, runner persistence, RC gates, and model routing.
- promptfoo is absent from all `package.json` dependency sections.
- ADR-0001 and ADR-0013 govern runtime-core dependency posture; dev-only additions still expand supply-chain and telemetry review surface.
- A spike comparison against two representative hermetic gates (`oracle-false-success-audit`, worker-profile fixture audits) showed Construct's runner already provides deterministic pass/fail authority, fixture pinning, and release gating without promptfoo's assertion-runner layer.

## Decision

**Reject** promptfoo adoption. Continue exclusive investment in `lib/certification/` and `lib/evals/`.

Native enhancements worth keeping instead of promptfoo:

1. Cross-model certification metrics (`lib/certification/cross-model-certification.mjs`) for cost, latency, and variance reporting.
2. KnowledgeStore mode matrix (`lib/certification/knowledge-store-matrix.mjs`) following the document I/O matrix precedent.
3. Prompt provenance graph nodes (`lib/graph/build-from-prompts.mjs`) for blast-radius queries without an external eval framework.

## Ownership boundary

| Concern | Owner |
|---|---|
| Scenario corpus, invocation path, pass/fail authority | Construct (`lib/certification/`) |
| Release gates and evidence persistence | Construct (`lib/certification/rc-gate.mjs`, `store.mjs`) |
| External assertion-runner ergonomics | Not adopted (would have been promptfoo-owned) |

## Rejected alternatives

- **Optional devDependency promptfoo with custom JS provider** — rejected: duplicates runner/report surfaces already present; adds version-specific telemetry disable flags and ADR-0001 amendment overhead; no gap filled that native modules cannot cover with lower supply-chain risk.
- **Replace lib/certification with promptfoo** — rejected by bead non-goals and by RC gate/load-bearing requirements.

## Consequences

- Positive: no new npm devDependency; no promptfoo telemetry/config review; construct certify default path unchanged.
- Negative: assertion DSL ergonomics from promptfoo remain unavailable; native report formatting stays Construct-owned.

## Reversibility

Re-open only with an ADR-0001 amendment scoped to dev-tooling deps, a fresh telemetry audit against the installed promptfoo version, and a prototype proving measurable signal-quality gain over native gates.
