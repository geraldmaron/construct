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
| D MCP | construct-vhuw | **in progress** |
| E Native integrations | construct-vv6l | open |
| F Product consolidation | construct-pxw2 | open |
| G Delete old surfaces | construct-fgxn | open |
| H Skills | construct-blvu | open |
| I External interfaces | construct-dz27 | open |
| J Package/release | construct-umx9 | open |

## Phase D (`construct-vhuw`) — in progress

Landed:

- Semantic interactive MCP: `project_status`, `start_run`, `next_work`, `submit_work`, `list_inbox`, `raise_decision`, `decide`
- Serve prefers v1 plane when project initialized
- `host-pull-serve` permanently refused (module delete is Phase G)
- Isolation: interactive path cannot import selection/census

Still for D close:

- `run_status` / activity read on interactive plane
- Operational construct skill (or hand to H)
- Enough coverage that Phase G can delete legacy projection without a hole

## What remains overall (ordered)

```
D  finish semantic MCP + refuse D
E  opencode/vscode (+assess) HostIntegrationAdapters; init-as-reconciler; demote wire
F  Staff + Routine product surface; merge judgment verbs; shrink CLI
G  Delete ledger: schema23, naming_cache, keyword routing, hostpull, legacy projection,
   cleanup, beads-in-product, interactive work.ts, lens auto-install, …
H  Skill scorecards; only operational skill auto-installs
I  Docs/help/first-run truth; close PRs #9/#11/#12/#13; lock package exports
J  Full gate; complexity vs baseline; provenance rebuild; release verdict
```

Inventory detail: `docs/internal/clean-slate-inventory.md`.

## Invariants

Current session executes by default. Cross-host requires explicit reason. Client ≠ host ≠ executor. MCP is interactive control plane. Project state is project-local. Dead architecture is deleted, not deprecated.
