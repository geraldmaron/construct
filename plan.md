# Clean-slate alpha reconciliation — living plan

Epic: `construct-cki1`.

## Baseline

| Fact | Value |
|------|-------|
| package.json | `3.0.0-alpha.18` |
| npm `alpha` | `3.0.0-alpha.19` (**no gitHead**, no git tag) |
| Compatibility | **none** |
| Release | **DO NOT PUBLISH** until Phase J |

## Phase status

| Phase | Bead | Status |
|-------|------|--------|
| A–G | … | **done** |
| H Skills | construct-blvu | **done** |
| I External interfaces | construct-dz27 | open |
| J Package/release | construct-umx9 | open |

## Phase H ledger

| Target | Status |
|--------|--------|
| Operational `construct` skill; only init auto-install | **done** |
| written-voice off `--all` / never auto | **done** |
| Lens packs never product auto-install | **done** (pack stays explicit) |
| Scorecards KEEP/REWRITE/MERGE/DELETE | **done** (`docs/internal/skill-scorecards.md`) |
| Agent Skills lint vs Construct policy | **done** |
| Progressive disclosure (SKILL.md + references/) | **done** |
| Eval harness (structural/size) | **done** (`scripts/skill-scorecard.mjs`) |
| A/B qualification / observed cross-host load | **named gap** (unmet; not faked) |

## What remains overall

```
DONE   A–H
OPEN   I  docs/help/first-run truth; close PRs #9/#11/#12/#13; lock exports
OPEN   J  full gate; provenance rebuild; release verdict
```

Detail: `docs/internal/clean-slate-inventory.md`.
