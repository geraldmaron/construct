---
intake: none
---

# Consolidated Findings — Wave 0 Synthesis

Authored 2026-07-17 by the program lead from the three investigation reports and the
dispatcher routing plan. Where reports disagreed, the reconciliation is stated explicitly.
Directive output coverage: this file advances outputs 14.1 (intent), 14.2 (truth map v1),
and seeds 14.4 (assumption register) and 14.5 (amalgamation report).

## Reconciliations

1. **"Flow engine" is two systems, and only one is dead.** The declarative workflow-manifest
   system (`lib/workflows/` → `workflow-defs.mjs`, 15 types, drift-tested) is live and
   load-bearing. The state-machine engine (`lib/flows/` + `delegation-flow.mjs`) is dead by
   the repo's own audit baseline. The intent report's "built, delegation path dead" and the
   truth map's "dead" refer to the same fact at different granularity. **Disposition input
   for E-cutover: the directive's "flow-engine deletion" target is `lib/flows/`, not
   `lib/workflows/`.**
2. **Graph reuse verdict.** The directive requires auditing the current graph before trust;
   the audit is done and favorable: the semantic layer (typed nodes/edges, provenance,
   multi-source seeding, impact analysis, staleness) is ~60–70% of the target and good
   [source: gap-table estimate in subagents/graph-and-state-audit.md § Verdict]. The
   gap is implementation shape: JSONL → SQLite relational tables, JS traversal →
   recursive CTE, full rebuild → incremental update + diff reconciliation, plus generic
   cycle/orphan/path queries. **The graph-foundation epic is a port-and-extend, not a
   rebuild.** The bootstrap graph required by the directive can be the existing builder
   plus a thin export, rather than a new temporary implementation.
3. **The pre-change-intent packet (`ff17508e`) is a sequencing dependency, not a baseline.**
   It exists only on `feat/bead-sprint-20260717`. The program must either wait for that
   branch to land or treat change-intent as part of the graph-foundation epic's scope.
   Recorded as assumption A3 below.

## Amalgamation report (seed — directive output 14.5)

Duplicate or competing architectures, all agent-reported with citations in
[execution-surfaces-truth-map.md](../subagents/execution-surfaces-truth-map.md) and
[graph-and-state-audit.md](../subagents/graph-and-state-audit.md):

| # | Duplication | Members | Severity |
|---|---|---|---|
| D1 | Approval/authority surfaces | `embed/approval-queue`, `writes/write-intent`, `mcp/destructive-approval`, `roles/approval-surface`, `cli/approvals` | High — no single governed-write chokepoint; directly contradicts the target's single authority boundary |
| D2 | Schedulers | `lib/scheduler/` (orphaned), `lib/embed/scheduler.mjs`, scheduled-tasks MCP | Medium |
| D3 | Overseer daemons with overlapping jobs | oracle daemon vs embed daemon | Medium — both poll/reconcile/self-repair/observe |
| D4 | Routing layers | `orchestration/routing-tables` vs `roles/router`+gateway (0 direct importers) | Medium |
| D5 | Run-store backends without shared migration story | filesystem / sqlite / postgres triplet | Medium — SQLite schema created inline, unversioned |
| D6 | Project-identity derivation ×3 | `state-root.deriveProjectKey`, `orchestration/store.projectKey`, `embed/daemon.resolveRootDir` (ADR-0092, construct-36w10) | High — state can land under different keys |
| D7 | Memory/retrieval paths | observation-store vs knowledge/rag | Medium |
| D8 | State-dir naming | `.construct` canonical vs `.cx` residue in docs/paths | Medium — README's state section is wrong |
| D9 | Telemetry tool alias | `cx_trace` + `cx_trace_telemetry` → same module | Low |

Dead/disconnected (deletion candidates with verification status):

| # | Component | Evidence | Status |
|---|---|---|---|
| X1 | `lib/flows/` + `orchestration/delegation-flow.mjs` | repo audit baseline `02-deadcode:module-test-only` | Verified dead by repo's own baseline |
| X2 | `lib/policy/engine.mjs.bak`, `lib/roles/manifest.mjs.bak` | stale `.bak` files | **Not tracked on main** — untracked debris in the primary checkout's working tree only; left for that checkout's owner to clear |
| X3 | `scripts/patch-registry-readers-v2.mjs` | spent one-shot codemod; only reference was its own lint-gate allowlist entry | Deleted this session after zero-reference check (allowlist entry removed with it) |
| X4 | `lib/scheduler/` | orphaned (mutual import with `hygiene/scan` only) | Bead filed — needs deeper confirmation (native-trigger installs may reference it at runtime) |
| X5 | Legacy provider `.js` tier (`provider-capabilities-*.js`, `cache-strategy-*.js`, `token-estimator-*.js`, `token-engine.js`, `dispatch-batch.js`) | pre-`lib/models/` generation | Split verdict (construct-b0nny.10): `dispatch-batch.js` was truly dead and deleted; the other four families are load-bearing (`lib/models/execution-capability-profile.mjs` itself imports `provider-capabilities.js`) — see [b0nny-10-keep-verdict.md](b0nny-10-keep-verdict.md) |

## Load-bearing assumption register (seed — directive output 14.4)

| ID | Assumption | Supporting | Opposing | If wrong | Test |
|---|---|---|---|---|---|
| A1 | Relational SQLite/Postgres recursive traversal meets graph workload at repo scale (~3.3k nodes / 8.5k edges today) | Data volume is small; existing JS traversal already fast | Transitive-closure queries over larger multi-repo workspaces unmeasured | Would need graph DB (directive forbids by default) | Validation spike A with measured build/update/query latency |
| A2 | Existing graph semantics (16×16 model) extend cleanly to the directive's ~35-type ontology | Provenance/confidence fields already exist | Ontology triples the type count; workspace scoping absent today | Schema redesign mid-program | WS5 target-model draft mapped onto existing data before E1 build |
| A3 | Pre-change-intent work lands from the sprint branch before graph-foundation starts | Active branch, recent commits | Branch may stall or change shape | E1 absorbs change-intent scope | Check `git merge-base --is-ancestor ff17508e main` at Wave 2 start |
| A4 | The five approval surfaces can converge on `writes/control-plane` as the single chokepoint | It already has 8 importers incl. all provider governed-writes | roles/approval-surface + destructive-approval have MCP-side couplings | Authority epic redesign | Trace every approval consumer during WS6 evidence pass |
| A5 | Beads remains viable as a projection adapter (not the domain model) | Dolt sync + jsonl fallback healthy; hygiene contract in place | 5.4MB jsonl and daemon contention already observed | Tracker-projection epic grows a migration | E8-equivalent epic includes field-authority + reconciliation proof |

## Intent verdict (directive output 14.1, condensed)

Construct's durable intent: **one person runs a real software organization from a single AI
interface, with organizational intelligence that accumulates** (STRATEGY.md northstar). The
directive's workspace-control-plane hypothesis is a *sharpening* of that intent — it keeps
the governance loop, evidence discipline, and delegation posture, and discards what diluted
it: organization *metaphor* (personas/roles/teams as fixed structure), team/enterprise
scaffolding without customers, brokered-MCP staging, and a dead deterministic-flow port.
Nothing found in Wave 0 contradicts the hypothesis; the duplication inventory (D1–D9)
is the concrete evidence for why a single control plane with typed domain objects is the
right consolidation target.

## Immediate actions taken this session (evidence-backed, low-risk)

1. Deleted X3 (spent codemod + its allowlist line) after zero-reference verification; X2
   `.bak` files turned out not to exist on main (primary-checkout debris only).
2. Fixed `docs/README.md` duplicate-string bug ("`.construct` vs `.construct`").
3. Replaced deprecated `construct matrix build` with `construct graph build` in
   `docs/guides/concepts/architecture.mdx`.
4. Updated STRATEGY.md's three stale "29-specialist / not yet applied" claims to reflect
   the landed 12-specialist consolidation.
5. Filed beads for everything larger (README `.cx/` rewrite, embeddings-legacy rename,
   X4/X5 verification, and all program waves) — see program.md § Tracker.

## What Wave 0 does NOT cover

External-framework research (§6), validation spikes (§11), target model (§8/9), disposition
matrix (14.13), maintenance budget (14.14), replacement strategy (14.15), bead program
(14.16). These are Waves 1–4 and each needs explicit maintainer go-ahead per the routing
plan.
