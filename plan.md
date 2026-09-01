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
| A Freeze and map | construct-uedv | **done** |
| B New foundations | construct-9xva | **done** |
| C Execution architecture | construct-dx84 | **done** |
| D MCP | construct-vhuw | **done** |
| E Native integrations | construct-vv6l | **done** |
| F Product consolidation | construct-pxw2 | **done** |
| G Delete old surfaces | construct-fgxn | open |
| H Skills | construct-blvu | open |
| I External interfaces | construct-dz27 | open |
| J Package/release | construct-umx9 | open |

## Phase F — done

- StaffMember / Routine / typed Inbox product CLI + MCP tools
- Headless `work claim|submit|status --pin=` on v1 (no ambient census)
- Judgment kinds: waive / revoke / verdict / consent / trust with resolve side effects
- Legacy judgment verbs on v1 route through DecisionService

Phase G deletes the legacy modules and aliases.

## What remains overall

```
DONE   A–F
NOW    G  DELETE ledger (schema23, naming_cache, keyword routing, hostpull module,
         legacy projection, cleanup, beads-in-product, interactive work.ts, …)
OPEN   H  skill scorecards; only operational skill auto-installs
OPEN   I  docs/help/first-run truth; close PRs #9/#11/#12/#13; lock exports
OPEN   J  full gate; provenance rebuild; release verdict
```

Detail: `docs/internal/clean-slate-inventory.md`.

## Invariants

Current session executes by default. Cross-host requires explicit reason. Client ≠ host ≠ executor. MCP is interactive control plane. Project state is project-local. Dead architecture is deleted, not deprecated.
