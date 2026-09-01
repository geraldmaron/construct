# Clean-slate forensic inventory (Phase A)

HEAD: `e9745325` · package: `3.0.0-alpha.18` · inventory date: 2026-08-31  
Epic: `construct-cki1` · Phase A: `construct-uedv`

Evidence: CLI `VERBS` registration, MCP tool arrays, `CREATE TABLE` in `store/open.ts`, import greps, package exports, open GitHub PRs, npm dist-tags. Comments alone were not used as reachability.

Machine inventories that fed this ledger: [Inventory CLI MCP storage](dee647f2-a60b-4427-ab45-4974cbf264c4) (verbs/MCP/schema/env/exports) and [Inventory hosts skills dead-code](166c4e82-d5c4-4b96-a9fe-e4e2e4ea1f23) (hosts/skills/tracker/daemon/god modules). Explore-agent **KEEP** tags in those reports are **not** product dispositions — §4 below overrides them under the clean-break mandate (e.g. cleanup, naming_cache, keyword routing, beads session-drift, standing/watch/schedule/daemon fragmentation).

---

## 1. Baseline revalidation

| Claim in prompt | Observed | Verdict |
|-----------------|----------|---------|
| main head `e9745325…` | Confirmed after `git pull` | Match |
| package `3.0.0-alpha.18` | Confirmed | Match |
| npm may disagree | `alpha` → `3.0.0-alpha.19`; no `gitHead`; no git tag | **Provenance drift** |
| open PRs #9 #11 #12 #13 | Closed 2026-09-01 (superseded); #6 draft audit remains | Match (closed) |
| no compatibility entitlement | Product decision | Confirmed |

---

## 2. Open PRs (close, do not merge wholesale)

| PR | Branch | Status |
|----|--------|--------|
| [#9](https://github.com/geraldmaron/construct/pull/9) | `first-run-stranger-80db` | **closed** 2026-09-01 — superseded (clean-slate interactive architecture) |
| [#11](https://github.com/geraldmaron/construct/pull/11) | `first-run-one-plus-three-5af9` | **closed** 2026-09-01 — superseded |
| [#12](https://github.com/geraldmaron/construct/pull/12) | `first-run-door-1-leak-b839` | **closed** 2026-09-01 — superseded |
| [#13](https://github.com/geraldmaron/construct/pull/13) | `warsaw-namer-seats-a1e1` | **closed** 2026-09-01 — superseded |
| [#6](https://github.com/geraldmaron/construct/pull/6) | `release-readiness-audit-6655` | Draft audit — keep as evidence, not merge |

Related remotes not open as numbered PRs above: `in-session-dispatch-dd4f` (0 commits ahead of main — already landed shape), `slim-ci-default-cfbf` (documents slim CI — **delete that policy**).

**Close policy:** when operational skill + semantic MCP + init reconciler land, close #9/#11/#12/#13 with one sentence: superseded by clean-slate interactive architecture (session-bound MCP, no RPC-in-prose, no opportunistic namers). **Done 2026-09-01** on construct-dz27.

---

## 3. Complexity baseline (before)

| Metric | Before |
|--------|-------:|
| Public CLI verbs | 41 |
| Internal CLI verbs | 2 |
| MCP unique tool names | 18 |
| MCP servers | 3 |
| SQLite tables | 37 |
| Schema version | 23 |
| Full execution adapters | 4 |
| Background concepts | standing + watch + schedule + daemon |
| Portable skill families | 7 |
| Generated skill packs | 15 |
| Production LOC (`src/**/*.ts`) | 55,288 |
| Test LOC (`tests/**/*.ts`) | 53,322 |

---

## 4. Subsystem disposition

Legend: **KEEP** (shape survives) · **REWRITE** (same job, new shape) · **MERGE** · **DELETE**

### CLI / product surface

| Subsystem | Disp. | Responsibility now | Callers / tests | User surface | Replacement | Reason |
|-----------|-------|--------------------|-----------------|--------------|-------------|--------|
| `construct work` interactive control plane | **DELETE** (interactive) / **REWRITE** (headless operator) | Session detect + census + chooseResource + leases + host construct | `work.ts` → selection + census; first-run / session-dispatch tests | Primary “run work” verb | `InteractiveRunService` via MCP; `HeadlessRunService` for explicit headless | RPC-in-prose; ambient routing authority |
| `construct wire` | **DELETE** | Manual MCP install | init, wire tests | Explicit wire step | `construct init` reconciler | Not a normal product workflow |
| `construct init` | **REWRITE** | Preview/tutorial + optional `--yes` wire/skills | init tests | First install | Real init: project state + integrations + operational skill + verify | Must initialize without ceremony |
| `construct doctor` | **REWRITE** | Host census + store health | maintenance tests | Diagnostics | Project/integration/session/MCP/skill matrix; no false “Ready” | Must prove intended experience |
| `outcome` / `ask` CLI | **REWRITE** → diagnostics/headless | Record outcome from terminal | outcome/ask tests | Terminal spine | MCP `start_run` / host-native; CLI optional operator | Interactive path is MCP |
| Judgment verbs (`inbox`, `decide`, `waive`, `revoke`, `verdict`, `consent`, `trust`) | **MERGE** | Seven faces of human judgment | show/decide/controls/settings | Many verbs | One Inbox/Approvals with typed entries | UX consolidation; keep security distinctions typed |
| `standing` / `watch` / `schedule` / `daemon` | **MERGE** → Routine | Four background universes | cli + kernel daemon/schedule/watch/store | Four verbs | One `Routine` + one runner | Prompt §29–30 |
| `cleanup` predecessor archaeology | **DELETE** | Uninstall legacy installs | cleanup catalog 964 LOC, many tests | `cleanup` | Git history; optional internal diag only | Alpha clean break |
| `reconcile` CLI (tracker projection) | **REWRITE** if product tracker connector; else **DELETE** from product | Diff projections vs `--live` JSON | reconcile tests | Dogfood-ish | `TrackerConnector` live R/W or remove | No manual JSON mirror |
| Beads `session-drift` / `reconcile-tracker` / `watch` construct-checkout | **DELETE** from product | Repo dogfood ritual | scripts + watch + hosts/repo | Construct-checkout special case | Keep as **repo-only** scripts outside package runtime | Beads ≠ Construct state |
| `serve` | **REWRITE** | MCP stdio presence + host-pull tools | serve, projection tests | `construct serve` | `construct serve --client=… --project=…` session binding | Structural identity |
| `host-pull-serve` + `CONSTRUCT_HOST_PULL` | **DELETE** | Flagged prototype server | hostpull tests | Internal | Fold claim/submit into semantic MCP without flag | Feature flag preserving old world |
| `role-serve` | **REWRITE** / narrow | Role bearer MCP writes | roleserve | Internal | Headless/role execution adapter boundary | Keep capability fencing; rename to execution seam |
| Package exports `./kernel/*` `./hosts/*` | **DELETE** or intentional SDK | Accidental public filesystem | package.json | Deep imports | CLI-only or tiny SDK | No accidental API |

### Storage

| Subsystem | Disp. | Reason |
|-----------|-------|--------|
| Schema v23 / 37 tables / home-store default | **DELETE** → replace | >20 eras; no migration; project-local v1 |
| `naming_cache` | **DELETE** | Outcome-text cache wrong under project/catalog/context; preferred delete until measured |
| Keyword `routing/dispatcher` on product path | **DELETE** from normal execution | Measured recall misses; interactive host proposes concerns |
| Task/deliverable coupled settle | **REWRITE** | Separate execution SM vs trust SM |
| `records` + `lessons` | **REWRITE** (challenge merge) | Structured memory only with provenance |

### Hosts / execution

| Subsystem | Disp. | Reason |
|-----------|-------|--------|
| `HostAdapter` (init/invoke/health/cancel) | **REWRITE** → `ExecutionAdapter` | One word meant three concepts |
| MCP config writers (claude/cursor/opencode) | **REWRITE** → `HostIntegrationAdapter` | Split install from execute |
| Ambient env detection as routing authority | **DELETE** as authority; keep for diagnostics | Session binding replaces it |
| `chooseResource` / census on interactive path | **DELETE** from interactive | Structural inaccessibility required |
| bob/goose/pi pins | **KEEP** as measurement; adapters TBD | Capability matrix honesty |
| Codex | **KEEP** assess | Adapter exists; integration incomplete vs interactive MCP |
| VS Code client | **REWRITE** missing | Client ≠ harness; needed |

### MCP

| Tool cluster | Disp. | Replacement direction |
|--------------|-------|----------------------|
| catalog + record_outcome | **REWRITE** | Semantic start_run / project_status; hide catalog vocabulary from user |
| claim_task + submit_work | **REWRITE** | next_work / submit_work with correct claim-token contract |
| work_log, run_status, inbox, decide, asks, answer, drop_note, records, record, validate_brief, verdict | **MERGE**/trim | Fewer semantic ops; server-side orchestration |
| Verbose tool tutorials / CLI instructions in descriptions | **DELETE** | Contract tests on description↔behavior |

### Skills

| Skill | Provisional | Notes |
|-------|-------------|-------|
| Operational `construct` skill | **REWRITE** (new) | Only auto-install; short; no CLI tutorial |
| investigative-research | **REWRITE** | Keep method; cut ceremony |
| adversarial-review | **REWRITE** | Add reproduce/execute claims |
| decision-framing | **REWRITE** (trim) | Keep reversibility/premortem |
| requirements-structuring | **REWRITE** (trim) | Keep observable acceptance |
| context-mapping | **REWRITE** | No inventing unknowns |
| intake | **MERGE?** | A/B vs requirements-structuring |
| written-voice | **DELETE** from default or split | No global house style |
| Generated lens persona packs | **DELETE** from product auto-install | Staff/concerns ≠ persona skills |
| AUTHORING / lint-skill-spec Construct ceremony | **REWRITE** | Separate Agent Skills spec vs Construct policy |

### God modules (split by ownership, not LOC)

| File | LOC | Disposition |
|------|----:|-------------|
| `kernel/run/coordinator.ts` | 1770 | **REWRITE** → Run/Task/Review services |
| `kernel/store/sources.ts` | 1069 | **REWRITE** → SourceService aggregate |
| `kernel/store/open.ts` | 1027 | **DELETE**/replace → schema v1 modules |
| `kernel/cleanup/catalog.ts` | 964 | **DELETE** |
| `cli/propose.ts` | 960 | **REWRITE**/trim |
| `hosts/compose.ts` | 853 | **REWRITE** clarify vs execution |
| `cli/work.ts` | 787 | **DELETE**/split interactive vs headless |
| `hosts/mcp/projection.ts` | 801 | **REWRITE** semantic MCP |
| `cli/daemon.ts` | 678 | **MERGE** into Routine runner |
| `tracker/session-drift.ts` | 548 | **DELETE** from product package |

---

## 5. Reachability highlights (delete candidates)

| Symbol / area | Production importers (src) |
|---------------|----------------------------|
| `chooseResource` | `cli/work.ts`, `kernel/hosts/selection.ts` |
| `surveyResources` | `cli/work.ts`, `cli/maintenance.ts`, `hosts/census.ts` |
| `naming_cache` / `NamingCache` | outcome/ask/projection/implication/store |
| `session-drift` | watch, hosts/repo, scripts/reconcile-tracker |
| host-pull | serve, projection, hostpull, session |
| cleanup catalog | maintenance, wire, mcpconfig, opencode adapter |
| keyword dispatcher | implication map/domains, routing, measures |

Interactive path today: ambient detect in `work.ts` can skip census when wired; otherwise `chooseResource(surveyResources(...))`. Contaminates “current session executes” when ambient misses.

---

## 6. CI gap

`.github/workflows/ci.yml`: PR/push runs lint + typecheck + `test:first-run` only. Full `npm test`, sterile HOME, packaged smoke = `workflow_dispatch` only. **Rewrite required** (prompt §46).

---

## 7. Deletion ledger plan (Phase G targets)

Not deleted yet — Phase A freezes the list:

- Interactive `work` as RPC protocol; `wire` product verb; host-pull flag/server
- Predecessor `cleanup` catalog + capture-legacy goldens (dev locks → drop with deleted contracts)
- standing/watch/schedule/daemon fragmentation
- naming_cache; keyword product routing
- Beads session-drift inside shipped runtime
- Generated persona skill packs as default install
- Accidental package deep exports
- Docs teaching removed architecture (`host-mcp-recipes`, wire-centric install, etc.)

Replacement tests must land before/with deletion (prompt §56).

---

## 8. Phase A exit criteria

- [x] Baseline revalidated
- [x] Machine inventory counts
- [x] Reachability samples on delete candidates
- [x] Disposition table
- [x] PR evidence table
- [x] Living `plan.md`
- [x] Phase B bead filed (construct-9xva) and scaffolding started
