# Clean-slate alpha reconciliation — living plan

Epic: `construct-cki1`. Phase A: `construct-uedv` (in progress).

## Baseline (revalidated 2026-08-31)

| Fact | Value | Verified |
|------|-------|----------|
| Default branch | `main` | `git status` after pull |
| Main HEAD | `e9745325bc8786c0625d12888626a45f51de7696` | matches prompt |
| `package.json` | `3.0.0-alpha.18` | node read |
| npm `alpha` dist-tag | `3.0.0-alpha.19` | `npm view` |
| npm `.19` gitHead | **missing** | provenance broken |
| npm `.18` gitHead | `32067b81…` | ancestor of main |
| Git tag `v3.0.0-alpha.19` | **absent** | `git tag -l` |
| Compatibility entitlement | **none** | product decision |

**Release note:** do not treat npm `3.0.0-alpha.19` as a trusted artifact until provenance is rebuilt. Next publish is a new intentional alpha after this architecture lands.

## Scale snapshot

| Bucket | Count |
|--------|------:|
| `src/**/*.ts` | 219 files / 55,288 LOC |
| `tests/**/*.ts` | 236 files / 53,322 LOC |
| Public CLI verbs | 41 (+ 2 internal) |
| MCP servers | 3 |
| Unique MCP tool names | 18 |
| SQLite schema version | 23 |
| SQLite tables | 37 |
| Full HostAdapters | 4 (claude, cursor, opencode, codex) |
| Pin-only hosts | 3 (bob, goose, pi) |
| Portable skills | 7 |
| Generated lens packs | 15 |

## Phase status

| Phase | Bead | Status |
|-------|------|--------|
| A Freeze and map | construct-uedv | **done** |
| B New foundations | construct-9xva | **in progress** (open until serve uses v1) |
| C Execution architecture | construct-dx84 | **done** |
| D MCP | construct-vhuw | **in progress** |
| E Native integrations | | pending |
| F Product consolidation | | pending |
| G Delete old surfaces | | pending |
| H Skills | | pending |
| I External interfaces | | pending |
| J Package/release | | pending |

## Open experiment branches / PRs

`gh` auth token invalid in this environment; PR bodies pulled via public GitHub API.

See `docs/internal/clean-slate-inventory.md` for PR evidence table and full disposition ledger.

**Policy:** close (do not merge wholesale) first-run experiment PRs once replacement lands. Harvest tests/concepts only.

## Phase B progress

**Substantially complete** (old store still in tree until cutover):

- `src/kernel/project/` — ProjectContext, layout, initialize, reset
- `src/kernel/state/` — format v1 schema (runs, tasks, deliverables, staff, sources, routines, decisions, integrations, activity)
- `src/kernel/services/` — Project/Run/Task/Staff/Source/Routine/Decision + Interactive/Headless run services
- `construct init` / `construct reset --yes`
- Architecture tests: interactive isolation from resource selection
- 21 focused tests green

**Residual before closing construct-9xva:** point MCP/serve at InteractiveRunService (handoff into Phase D).

## Phase C (`construct-dx84`) — in progress

Landed:

- `src/kernel/integration/types.ts` — HostIntegrationAdapter
- `src/kernel/execution/types.ts` — ExecutionAdapter
- `src/kernel/execution/precedence.ts` — explicit executor order (interactive never falls to selection)
- `src/kernel/execution/from-host.ts` — HostAdapter → ExecutionAdapter bridge
- `src/kernel/session/binding.ts` — `serve --client=… --project=…`
- Cursor + Claude Code HostIntegrationAdapters (session-bound MCP merge)
- Unsupported stubs for opencode/bob/vscode/codex/goose/pi
- Architecture + precedence + wire/mcpconfig tests
- Docs: consumer-install + walkthrough show session-bound serve args

Still open for Phase C close:

- Serve still opens legacy store (`withStoreAsync`); project flag is identity only until Phase D cutover
- Broader host matrix writers (Phase E)
- Semantic MCP over InteractiveRunService (Phase D)

## Invariants (release contract excerpt)

Current session executes by default. Cross-host requires explicit reason. Client ≠ host ≠ executor. MCP is interactive control plane. Project state is project-local. Dead architecture is deleted, not deprecated.
