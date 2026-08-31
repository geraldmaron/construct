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
| B New foundations | construct-9xva | **done** |
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

**Closed into Phase D handoff** — foundations live; `construct serve` opens v1 interactive MCP when `.construct` is initialized.

## Phase C (`construct-dx84`) — **done**

Session binding, integration/execution seams, HostAdapter bridge, Cursor/Claude writers.

## Phase D (`construct-vhuw`) — in progress

Landed:

- `src/hosts/mcp/interactive.ts` — semantic tools: `project_status`, `start_run`, `next_work`, `submit_work`, `list_inbox`
- `construct serve` prefers this plane when project has format-v1 state; legacy projection remains for uninitialized trees until Phase G
- Claim → submit settles task done + deliverable draft (no promotion)
- Isolation test: interactive MCP cannot import selection/census

Still open:

- Replace remaining legacy projection tools for init'd projects (already gated)
- Delete host-pull as product path
- Operational skill + fuller inbox/decide surface
- Close Phase B residual checklist once D acceptance holds

## Invariants (release contract excerpt)

Current session executes by default. Cross-host requires explicit reason. Client ≠ host ≠ executor. MCP is interactive control plane. Project state is project-local. Dead architecture is deleted, not deprecated.
