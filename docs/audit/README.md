# Audit Docs

Maintainer-only — excluded from the public docs site; not linked from README.

Historical audits and evidence records live here. Treat files in this directory as dated snapshots: update current product behavior in the canonical docs, and only edit audit records when correcting the record itself.

## Dependency audits

- [Model → surface dependency audit (2026-06-21)](./model-surface-dependency-audit-2026-06-21.md) — `construct-rmk8.5`: model resolution → capability profile → adapter → tool/prompt policy → evidence verdict → surfaces; maps verified gaps to governed-loop beads.

## Alignment program

- [Alignment scorecard (2026-06-19)](./alignment-scorecard-2026-06-19.md) — full documentation and site alignment pass
- [Alignment baseline snapshot (2026-06-19)](./alignment-baseline-snapshot-2026-06-19.json) — point-in-time census metrics
- [Alignment scorecard (2026-06-18)](./alignment-scorecard-2026-06.md) — Phase 0 end-review baseline
- [Skill consolidation proposal (2026-06)](./skill-consolidation-proposal-2026-06.md) — bound-orphan triage (maintainer approval gate)

Reproduce census: `node scripts/alignment/census.mjs`
