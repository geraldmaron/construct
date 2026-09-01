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
| A–H | … | **done** |
| I External interfaces | construct-dz27 | **done** |
| J Package/release | construct-umx9 | open |

## Phase I ledger

| Target | Status |
|--------|--------|
| first-run / README / walkthrough / consumer-install truth | **done** |
| Close PRs #9/#11/#12/#13 supersession | **done** |
| Package exports locked (`.` only) + regression test | **done** |
| Help text: init-first, thin work gloss | **done** |
| Doc lint agrees with shipped verbs | **done** |

## What remains overall

```
DONE   A–I
OPEN   J  full gate; provenance rebuild; release verdict
         (CI full test/smoke, package provenance, publish decision)
```

Also still open outside this epic (ready queue): install-to-first-value
epics, consumer-app packets, staff operation, PRD→tracker packet, pack
breadth, privacy/EDR miss-pattern bug (`construct-hn41`).

Detail: `docs/internal/clean-slate-inventory.md`.
