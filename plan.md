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
| A–F | … | **done** |
| G Delete old surfaces | construct-fgxn | **in progress** |
| H Skills | construct-blvu | open |
| I External interfaces | construct-dz27 | open |
| J Package/release | construct-umx9 | open |

## Phase G deletion ledger

| Target | Status |
|--------|--------|
| Deep package exports `./kernel/*` `./hosts/*` | **done** |
| `wire` product verb | **done** |
| `host-pull-serve` + hostpull module | **done** |
| Legacy MCP `projection.ts` (serve requires v1) | **done** |
| `cleanup` catalog + verb | pending |
| naming_cache wiring / table | pending |
| keyword routing on product path | pending |
| standing/watch/schedule/daemon modules | pending |
| interactive home-store `work.ts` path | pending |
| session-drift from package runtime | pending |
| persona pack auto-install / pack verb | pending (H) |

## What remains overall

```
DONE   A–F
NOW    G  cleanup, naming_cache, keyword routing, background verbs, legacy work, session-drift
OPEN   H  skill scorecards; only operational skill auto-installs
OPEN   I  docs/help/first-run truth; close PRs #9/#11/#12/#13; lock exports
OPEN   J  full gate; provenance rebuild; release verdict
```

Detail: `docs/internal/clean-slate-inventory.md`.
