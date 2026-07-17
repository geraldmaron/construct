---
intake: none
---

# Retain / Rebuild / Replace / Remove Matrix — Workspace Control Plane

Authored 2026-07-17 by the Wave 2 (parallel) lead, bead `construct-b0nny.4`, epic
`construct-b0nny`. Strong single lead per [routing-plan.md](../subagents/routing-plan.md) WS6:
the lead writes every disposition verdict; evidence gathering may fan out but verdicts do not.
This document advances directive outputs **14.13** (retain/rebuild/replace/remove matrix),
**14.14** (maintenance budget per subsystem), and **14.15** (replacement strategy: permanent
components, temporary adapters, migrated/discarded data, removed commands, cleanup milestones,
point of no return, rollback).

Verified against the worktree on branch `chore/b0nny.4-disposition-matrix`, forked from
`feat/workspace-control-plane` at `9254bd10`. Every "remove"/"rebuild"/"replace" verdict was
re-verified by the lead with static-import **and** name-string/dynamic-dispatch search (not the
truth map's framing alone), following the precedent set by
[b0nny-9-keep-verdict.md](b0nny-9-keep-verdict.md) and
[b0nny-10-keep-verdict.md](b0nny-10-keep-verdict.md), where two Wave-0 "dead"/"orphaned" calls
were overturned by direct inspection. Paths cited are confirmed present on this branch unless
marked `unverified`. Naming follows program rule 1: no version-suffixed names.

Inputs read in full: [execution-surfaces-truth-map.md](../subagents/execution-surfaces-truth-map.md),
[consolidated-findings.md](consolidated-findings.md) (D1–D9, X1–X5, A1–A5),
[target-model.md](target-model.md) (the 18 concepts, epic mapping),
[graph-and-state-audit.md](../subagents/graph-and-state-audit.md) (state stores, D5/D6/D8),
[directive.md](../directive.md) §7/§13/§14/§15/§17 (decision list, sustainability budget,
E0–E9 epic structure, replacement-strategy vocabulary).

## Verdict legend

The four dispositions map to the directive's §14.13 vocabulary and the program's "every
replacement carries its deletion" invariant (program rule 2):

- **retain** — keep substantially as-is and evolve in place. The capability is sound and the
  implementation shape is close enough to the target that a rewrite is not justified.
- **rebuild** — keep the capability, re-implement its *shape* (e.g. storage substrate, schema
  discipline). The public behavior survives; the internals are rewritten.
- **replace** — the capability is delivered by a *different target owner/concept*; the current
  implementation is superseded and deleted once the replacement carries the load.
- **remove** — delete outright; the capability is not carried forward. Every remove states its
  deletion criteria and what reconciles the old state.

A verdict is on the *subsystem*, not on whether the target already exists — several "retain"
subsystems still get a concept-layer rename (e.g. workflow→Procedure) or a new scope field.

## Verdict tally

Over the 24 primary subsystems (the truth map's enumerated surfaces plus the org-metaphor
layer, launcher, and ACP server):

| Verdict | Count | Subsystems |
|---|---|---|
| **retain** | 17 | CLI; embed daemon; doctor watchers; hooks; MCP server; workflow engine; orchestration runtime; provider+contract adapters; legacy provider `.js` tier; observation/entity memory; knowledge/RAG; governed-write pipeline; MCP destructive-gate; telemetry; schedulers (both Construct-owned); ACP server; launcher |
| **rebuild** | 1 | run-store persistence backends |
| **replace** | 5 | oracle daemon; roles layer; model-router/provider-invocation loop; vector store in core; org metaphor (specialists/personas/teams/scopes) |
| **remove** | 1 | dead flow engine (`lib/flows/` + `delegation-flow.mjs`) |

**Only one whole subsystem earns an outright "remove": the dead flow engine.** Everything else
that gets deleted is a *duplicate, alias, or residue inside a retained subsystem* — tracked in
the D1–D9 and X1–X5 ledgers below, not as a subsystem removal. This distribution is itself the
headline finding: consistent with the b0nny.9/.10 precedent, almost nothing in Construct is
wholly dead; the work is consolidation (5 replaces), one storage rebuild, and disciplined
intra-subsystem cleanup — not demolition.

Intra-subsystem removals (deletion ledger, counted separately from the 24):
`cx_trace_telemetry` alias (D9); the two divergent project-identity derivations (D6);
`.cx` naming residue (D8); `.bak` debris (X2, already absent here); `dispatch-batch.js`
(X5, removed Wave 0); `patch-registry-readers-v2.mjs` codemod (X3, removed Wave 0).

## Corrections and narrowings to Wave 0 (precedent-style)

Following the b0nny.9/.10 rule that a "dead"/"orphaned" claim must survive both static-import
and name-string inspection, four Wave-0 characterizations were narrowed or corrected here, and
one confirmed:

1. **`roles/router.mjs` is NOT orphaned.** Truth map §6: "roles/router.mjs has 0 direct
   import-path consumers … aspirational wiring." Direct grep confirms 0 *direct* importers, but
   `router.mjs`'s `route()` is imported and called by `lib/roles/gateway.mjs:18,257`
   (`import { route as routeEvent }` → `const r = routeEvent(event)`), and `gateway.mjs`'s
   `recordAndMaybeInvoke` is called live by `lib/oracle/execute.mjs:65`. So the router is one
   hop from a live daemon caller — the same static-grep blind spot the .9 verdict corrected for
   `lib/scheduler/`. The roles *layer* is load-bearing: `event-bus.mjs` has 5 live importers
   (`embed/recommendation-store`, `embed/docs-lifecycle`, `intake/prepare`,
   `hooks/agent-tracker`, `scopes/lifecycle`), and `catalog`/`manifest`/`approval-surface` are
   all wired. Verdict downgraded from "dead/aspirational" to **replace via consolidation**.

2. **D1 "five competing approval surfaces" is materially narrower than framed** (this is the WS6
   evidence pass that assumption **A4** assigns). Tracing every consumer shows three of the five
   are *layers of one pipeline*, not competitors:
   `control-plane.mjs` (header lines 6–10, 34–36) produces a `writeIntent`
   (`writes/write-intent.mjs`) → hands it to the `ApprovalQueue` (`embed/approval-queue.mjs`) →
   executes via `writes/envelope.mjs` with `writes/sent-log.mjs` dedup. `mcp/destructive-approval`
   has **0 static importers**; it is reached only as a *token gate* in front of the same
   envelope (`mcp/destructive-gate.mjs:10` `consumeApprovalToken`, `dispatch-envelope.mjs:16`
   `checkDestructiveGate`, and `tool-definitions-memory.mjs:320` documents the write "then routes
   through the J2 envelope … to the governed-write adapter"). Only `roles/approval-surface.mjs`
   (consumed by `hooks/edit-guard`, `hooks/guard-bash`, `embedded-contract/workflow-invoke`) is a
   genuinely *parallel* approval recorder. **A4 supported, D1 severity narrowed High→Medium**:
   the single chokepoint substantially exists; the gap is formalization plus folding in one
   parallel recorder and reconciling the MCP token-gate, not collapsing five peers.

3. **The "third scheduler" is not Construct's code.** Truth map §2/D2 count "scheduled-tasks MCP
   as a third surface." Grep for `scheduled-tasks` across `lib/`, `bin/`, `platforms/`, config,
   and templates returns **zero** hits (only the two Wave-0 research docs mention it). It is an
   external environment MCP, not a subsystem Construct ships or maintains. **D2 narrows to two
   Construct-owned schedulers** (`lib/scheduler/` native-trigger; `lib/embed/scheduler.mjs`
   interval, 20 `#scheduler.register` sites in `embed/daemon.mjs`), each with a distinct job set —
   a smaller reconciliation than "three schedulers."

4. **There is no `run-store-filesystem.mjs`.** Truth map §6/D5 name a
   "filesystem/sqlite/postgres triplet" as if three files. On disk: `run-store.mjs` (the
   filesystem/Mode-A backend, per its own header), `run-store-sqlite.mjs`, `run-store-postgres.mjs`,
   selected via `lib/storage/backend-registry.mjs`
   (`BUILTIN_STORAGE_BACKENDS = ['filesystem','sqlite','postgres']`). D5's substance holds (three
   backends, inline unversioned SQLite schema) but the file-naming in the truth map is corrected.

5. **X1 confirmed dead (not a narrowing — a positive removal verdict).** `lib/flows/` is imported
   only by `tests/flows-*.test.mjs`, two functional flow tests, and `delegation-flow.mjs`;
   `delegation-flow.mjs` is imported only by three test files; `buildDelegationFlow`/
   `advanceDelegation` have **zero** non-test callers in `lib/`/`bin/`/`scripts/`; and the MCP
   tool that once drove it (`orchestration_delegation_next`) is genuinely gone — its only
   occurrences are a "tool name miss" fixture in `learning-loop-capture.functional.test.mjs` and
   the self-documenting comment in `delegation-flow.mjs:30`. Safe to remove, with ~11 test files
   as mandatory deletion cleanup.

---

# Primary subsystem matrix

Fields per row: **purpose · current use · problems · graph deps · disposition · rationale ·
migration · deletion criteria (if remove) · maintenance budget (if retained)**. Maintenance
bands are estimates (directive §13 dimensions): **Low** ≈ <0.2 maintainer-days/mo, **Medium**
≈ 0.2–0.6, **High** ≈ >0.6; the directive's ≤2 d/mo total ceiling is itself a design pressure
behind the replace/remove verdicts.

## Cluster A — Surfaces (CLI, MCP, ACP, hooks, launcher)

### A1. CLI (`bin/construct`, 111 commands) — **retain**
- **Purpose.** The single public binary; ~80 top-level `lib/` imports; large if/else dispatch
  ladder; descriptive registry in `lib/cli-commands.mjs`.
- **Current use.** The most load-bearing surface (truth map §1); 111 top-level commands, 282
  `name:` entries across 8 categories.
- **Problems.** Dispatch is a hand-rolled ladder, not a `registerCommand` table; command sprawl
  (directive §19 warns against "commands without a coherent product role").
- **Graph deps.** Fronts nearly every subsystem; `construct graph`/`matrix` command overloads the
  `graph` name with `lib/task-graph/` (audit part A).
- **Disposition/rationale.** Directive §7 asks "whether the CLI survives" — yes. It is the
  local-first control surface the whole product depends on. Evolve in place; E9 "old command
  removal" prunes commands without a product role, but the surface stays.
- **Migration.** No cutover. Retire orphaned commands per an E9 command-role audit; disambiguate
  the `graph`/`matrix`/task-graph overload (rename the deprecated `matrix` alias out).
- **Maintenance budget.** **Medium** — driver: command count churn + help/doc upkeep; each new
  subsystem adds a command. Bounded by the E9 command prune.

### A2. MCP server surface (`lib/mcp/`) — **retain**
- **Purpose.** Thin dispatcher (stdio + http, broker mode); 18 flat core tools + a `call`
  gateway meta-tool for the long tail; `dispatchToolByName` ~60-branch table;
  `TOOL_SAFETY`-classified defs; budget/rate-limit/destructive-gate guardrails.
- **Current use.** Central (~15 modules reference it); tools reached by name string, so
  static-import grep undercounts consumers (truth map §4).
- **Problems.** Dual-registration debris (`cx_trace` + `cx_trace_telemetry` → same module, D9);
  long-tail gateway is a token-budget workaround, not a clean surface.
- **Graph deps.** Node type `tool`/`surface`; `exposes`/`requires` edges to providers.
- **Disposition/rationale.** Directive §7 "MCP participation" → retained as a first-party
  protocol surface (directive delegates ACP/A2A internals but MCP is the primary tool surface).
- **Migration.** Remove the `cx_trace_telemetry` alias (D9, below). Otherwise evolve; the
  core/long-tail split stays until the flat surface fits model windows.
- **Maintenance budget.** **High** — driver: protocol churn (MCP spec + MCP Tasks) + per-tool
  safety classification + surface-parity assertions on every load.

### A3. ACP server (`lib/acp/server.mjs`) — **retain**
- **Purpose.** `session/prompt` dispatch surface into the orchestration runtime (truth map §6).
- **Current use.** One of the orchestration dispatch surfaces alongside MCP `orchestration_run`
  and `worker_run`.
- **Problems.** Second protocol surface to maintain; coupling to runtime internals `unverified`
  in depth here.
- **Graph deps.** `exposes` edge to the runtime; node type `api route`/`surface`.
- **Disposition/rationale.** Directive §7 "ACP participation" — kept behind the runtime contract
  (E4). ACP is the editor-communication path the directive explicitly delegates to.
- **Migration.** Fold behind the E4 runtime/isolation-adapter contract; no data migration.
- **Maintenance budget.** **Low–Medium** — driver: ACP protocol churn only.

### A4. Hooks (`lib/hooks/*.mjs`, 41 files) — **retain**
- **Purpose.** ~40 registrations across 7 events (`platforms/claude/settings.template.json`;
  the `.claude/settings.json` the truth map cites is the *generated* output): bootstrap-gate,
  guards, linters, audit, recovery, session lifecycle.
- **Current use.** The enforcement backbone; every hook invokes through the launcher.
- **Problems.** Coverage gap: truth map §3 flags unregistered files
  (`proactive-activation.mjs`, `rule-verifier.mjs`). Direct check: `proactive-activation.mjs`
  is referenced by `lib/hooks/pre-compact.mjs`, so it is **not** cleanly dead — a coverage audit
  is warranted before any removal. `unverified` whether `rule-verifier.mjs` is reachable.
- **Graph deps.** Hooks emit role events (`event-bus`), write observations, drive the graph
  advisory (`graph-impact-advisory.mjs`).
- **Disposition/rationale.** Retain — hooks are the "hooks fire unconditionally" enforcement the
  repo depends on (CLAUDE.md). Evolve toward the E6 policy chokepoint for approval-shaped hooks.
- **Migration.** File a hook-coverage-audit bead (which `lib/hooks/*` files are registered vs
  dynamically invoked vs dead); route approval-shaped hooks (`edit-guard`, `guard-bash`) through
  the E6 chokepoint rather than `roles/approval-surface`.
- **Deletion criteria (per unregistered file, not the layer).** A `lib/hooks/*` file is removable
  only after proving zero settings registration **and** zero dynamic reference (the
  `proactive-activation`→`pre-compact` edge is the counter-example that blocks a blind sweep).
- **Maintenance budget.** **High** — driver: 41 files, each a live session-blocking surface;
  test burden + edit-with-care (CLAUDE.md protected).

### A5. Launcher (`.construct/launcher/run.mjs`) — **retain**
- **Purpose.** Dependency-free 7-tier resolver (dev-path → self-repo → node_modules → npx →
  global → cached → docker); every hook invokes through it.
- **Current use.** Load-bearing for all hook execution (truth map §2).
- **Problems.** None surfaced; resolver order is the single point every hook depends on.
- **Graph deps.** Root of hook execution; not a domain node.
- **Disposition/rationale.** Retain — directive §13 "clean uninstall" + "replaceable runtimes"
  both lean on a resolver that works with no always-on infrastructure.
- **Maintenance budget.** **Low** — driver: resolver-tier drift only (rare).

## Cluster B — Daemons and overseer loop (D3)

### B1. Embed daemon (`lib/embed/daemon.mjs`) — **retain**
- **Purpose.** The heavily-wired overseer: config, provider registry, interval scheduler,
  snapshot, ~11 scheduled job families (20 `#scheduler.register` sites), authority guard.
- **Current use.** 8 importers; runs snapshot/provider-health/session-distill/self-repair/
  approval-expiry/write-intent-drain/eval-sync/regression-check/inbox/roadmap/directive-runner.
- **Problems.** Overlaps the oracle daemon (D3: both poll/reconcile/self-repair/observe).
- **Graph deps.** Consumes control-plane, approval-queue, providers, graph.
- **Disposition/rationale.** Retain as the **survivor** of the D3 consolidation — it is the more
  wired of the two overseers and already hosts the interval scheduler + write-intent drain.
- **Migration.** Absorb Oracle's non-duplicative jobs (directive execution, read-model
  reconciliation) as it retains; converge on one daemon supervising one job set.
- **Maintenance budget.** **High** — driver: ~11 job families × provider maintenance +
  self-repair + supervision (launchd/systemd) OS support.

### B2. Oracle daemon (`lib/oracle/`) — **replace**
- **Purpose.** Read-model synthesis, reconciliation, directive execution
  (`directive-executor.mjs`), remediation dispatch; liveness watched by
  `doctor/watchers/oracle-liveness.mjs`.
- **Current use.** Live daemon; `oracle/execute.mjs` drives the roles gateway
  (`recordAndMaybeInvoke`, execute.mjs:65); `oracle/read-model.mjs` consumes the dependency
  graph.
- **Problems.** Duplicates the embed daemon's poll/reconcile/self-repair/observe loop (D3);
  directive §17 E9 explicitly lists "Oracle deletion."
- **Graph deps.** Reads the dependency graph, org graph, observations, outcomes, violations.
- **Disposition/rationale.** **Replace** — the *distinct Oracle overseer entity* is superseded by
  the consolidated embed-based overseer (B1) plus the E1 graph reconciliation and E5
  workplace-loop; its useful jobs (directive execution, reconciliation) migrate, its separate
  daemon/liveness/read-model plumbing is deleted. Not "remove" because the *capabilities* survive
  under new owners.
- **Migration.** Re-home `directive-executor.mjs` under E5 (sources/directives/workplace loop);
  re-home read-model reconciliation under E1 (graph); route remediation through the E6 effects
  chokepoint; keep the roles-gateway call path until roles is consolidated (C-cluster).
- **Deletion criteria (of the Oracle *entity*).** `lib/oracle/daemon-entry.mjs` +
  `doctor/watchers/oracle-liveness.mjs` deleted only after: (a) directive execution runs under
  E5 with equivalent tests green; (b) reconciliation runs under E1; (c) zero remaining importers
  of `lib/oracle/read-model.mjs` outside migrated code; (d) `construct dev`/`service-manager`
  no longer starts `runOracleDaemon`. Reconcile `.construct/oracle/` state (pending, raised-issues,
  verdicts, routing) into the E5/E1 stores before removing the directory.
- **Maintenance budget.** N/A (replaced).

### B3. Doctor watchers (`lib/doctor/watchers/*`) — **retain**
- **Purpose.** Liveness/health watchers (oracle-liveness, orchestration-runs, write-pipeline,
  graph-staleness, source-targets).
- **Current use.** Started by `service-manager`; the observability floor.
- **Problems.** `oracle-liveness.mjs` becomes dead when Oracle is replaced (B2) — tracked as
  part of B2's deletion criteria, not a separate removal.
- **Graph deps.** Reads run-store, write pipeline, graph staleness.
- **Disposition/rationale.** Retain — the health-watch capability maps directly to the target's
  observability requirements (directive §12) and E6 external-verification.
- **Migration.** Retire `oracle-liveness.mjs` with B2; keep the rest; add a workplace-loop
  watcher under E5.
- **Maintenance budget.** **Low–Medium** — driver: one watcher per durable pipeline; test burden.

## Cluster C — Orchestration, roles, workflows, flows

### C1. Orchestration runtime (`lib/orchestration/runtime.mjs` + `worker.mjs`) — **retain**
- **Purpose.** `planRun`/`executeRun`/`getRun`; MCP `orchestration_run` (host-sampling loop),
  readiness/status/cancel; classification, routing-tables, flow-selection, recruiter, gates.
- **Current use.** 5 importers but the highest-value surfaces; maps directly to target concepts
  Run (8) and Assignment (9).
- **Problems.** Run persistence has three backends with no shared migration story (D5);
  routing-tables are duplicated by the roles router (D4).
- **Graph deps.** `orchestration_runs` table; `evidenced_by` runtime-evidence edges seed the
  graph (audit part A).
- **Disposition/rationale.** Retain the runtime — it is the executor the whole work-model plans
  against (target §Run/§Assignment). The persistence *shape* is rebuilt (C2); the routing
  *duplication* is resolved by the roles replace (C4).
- **Migration.** Keep runtime/worker; consolidate routing so `roles/router` folds into
  `orchestration/routing-tables` (D4); pin Run→one Plan version (target concept 8).
- **Maintenance budget.** **Medium–High** — driver: host-sampling loop + gate logic + run
  lifecycle; the hottest-value surface, so test burden is high.

### C2. Run-store backends (`run-store.mjs`, `run-store-sqlite.mjs`, `run-store-postgres.mjs`) — **rebuild**
- **Purpose.** Filesystem (Mode-A), SQLite (Mode-B), Postgres (Mode-C) persistence for
  orchestration runs; backend selected via `storage/backend-registry.mjs`.
- **Current use.** Live; SQLite schema is created **inline in code, unversioned** (audit part B,
  D5). Postgres has a real migration runner (`lib/db/migrate.mjs`,
  `lib/db/migrations/001_orchestration_runs.sql`); SQLite does not.
- **Problems.** No shared migration story across the three backends; the SQLite schema drifts
  from the Postgres migrations with nothing to reconcile them (D5).
- **Graph deps.** `Run` node / `orchestration_runs` table; `executed-by` edge.
- **Disposition/rationale.** **Rebuild** the persistence shape (not the runtime): give the SQLite
  run-store real versioned migration files under `lib/db/migrations/` and converge the three
  backends on one migration story (target concept 8 migration note). The *capability* (durable
  runs) is unchanged; the internals are rewritten.
- **Migration.** Author migration files that reproduce the current inline SQLite schema as
  version 1; add a backend-parity test asserting SQLite and Postgres return equivalent run
  records (mirrors the directive §4 day-one "equivalent results on SQLite and Postgres").
- **Deletion criteria.** Delete the inline `CREATE TABLE` code path from `run-store-sqlite.mjs`
  only after the migration runner owns the schema and the parity test is green.
- **Maintenance budget.** **Medium** — driver: schema-migration burden across two DB engines.

### C3. Workflow engine (`lib/workflows/` + `embedded-contract/workflow-defs.mjs`) — **retain**
- **Purpose.** Declarative workflow manifests (15 `WORKFLOW_TYPES`, `INTAKE_TO_WORKFLOW`);
  loader/validate/liveness/surface-parity; templates in `templates/workflows/*.yml`;
  drift-tested (`tests/workflows/workflow-defs-drift.test.mjs`).
- **Current use.** Live and load-bearing (5 importers of the loader; feeds the whole workflow
  catalog). This is the **live** half of the "two flow systems."
- **Problems.** Concept name collides with the graph's `workflow`/`flow` overloads.
- **Graph deps.** `procedure`-role node (currently `workflow` node type); `requires` edges to
  providers/tools validated by `graph/validate.mjs` ("workflow→provider→tool requires-integrity").
- **Disposition/rationale.** Retain — this is target concept 11 (Procedure). The implementation
  stays; only the *concept-layer name* changes (workflow→Procedure).
- **Migration.** Rename `workflow` graph node type → `procedure` (target concept 11 migration
  note); keep `lib/workflows/` as-is. The rename is a migration cost, not a rebuild.
- **Maintenance budget.** **Low–Medium** — driver: manifest-schema drift + surface-parity tests;
  extension is drop-in declarative, so churn is bounded.

### C4. Roles layer (`lib/roles/*`, 11 files) — **replace**
- **Purpose.** Event→persona routing off `orchestration/routing-tables.mjs`: `router` (route,
  ownerOf), `gateway` (recordAndMaybeInvoke), `event-bus` (emit/emitBestEffort), `catalog`
  (listRoles), `manifest` (personas), `approval-surface` (recordApprovalRequest), plus
  hook-emit/fence/preference/flavor-bindings/cli.
- **Current use — corrected (see narrowing 1).** Load-bearing, not orphaned. `router.route()` is
  called by `gateway.mjs:257`; `gateway.recordAndMaybeInvoke` is called by `oracle/execute.mjs:65`;
  `event-bus` has 5 live importers (embed×2, intake, hooks/agent-tracker, scopes); `catalog`
  feeds `embedded-contract/capability.mjs` + `role-facts.mjs`; `manifest` feeds
  `doctor/watchers/bd-watch.mjs`; `approval-surface` feeds two hooks + `workflow-invoke`.
- **Problems.** It is a **competing routing layer** (D4) duplicating `orchestration/routing-tables`;
  routing *results* are frequently null (the "aspirational" symptom is silent null returns, not
  dead wiring); it is the concrete carrier of the org metaphor the directive discards.
- **Graph deps.** Reads `routing-tables`; `owned_by`/`governed_by` edges; the `specialist` node
  type (→ `worker profile` per target concept 10).
- **Disposition/rationale.** **Replace** — the routing role folds into `orchestration/routing`
  (D4), the persona/catalog role folds into Worker Profile (target concept 10), the
  `approval-surface` role folds into the E6 chokepoint (D1/A4). The one genuinely load-bearing
  primitive — the `event-bus` signal backbone with 5 importers — is *rehomed*, not deleted.
- **Migration.** (a) Merge `router`/`gateway` routing into `orchestration/routing-tables`;
  (b) migrate `catalog`/`manifest` persona data into Worker Profiles (concept 10);
  (c) route `approval-surface.recordApprovalRequest` (from `edit-guard`, `guard-bash`,
  `workflow-invoke`) through the E6 chokepoint; (d) preserve `event-bus` as the rehomed event
  primitive its 5 importers depend on.
- **Deletion criteria.** Delete `router.mjs`/`gateway.mjs` only after `oracle`/consolidated
  overseer route through `orchestration/routing`; delete `approval-surface.mjs` only after its
  three consumers route through E6 (D1); keep/rehome `event-bus.mjs` until its 5 importers have a
  replacement emit path. Reconcile `.construct/…/routing/` state into the orchestration store.
- **Maintenance budget.** N/A (replaced).

### C5. Dead flow engine (`lib/flows/` + `orchestration/delegation-flow.mjs`) — **remove**
- **Purpose.** State-machine flow engine (define/engine/checkpoint/joins/state/schema/constants)
  + `delegation-flow.mjs`, once the deterministic delegation-chain driver.
- **Current use — confirmed dead in production (see narrowing 5).** `lib/flows/` imported only by
  `tests/flows-*.test.mjs`, two functional flow tests, and `delegation-flow.mjs`;
  `delegation-flow.mjs` imported only by `orchestration-delegation-flow`/`-route-path`/`-policy`
  tests; `buildDelegationFlow`/`advanceDelegation` have zero non-test callers; the driving MCP
  tool `orchestration_delegation_next` is removed (only a "tool name miss" fixture references it).
  Repo's own audit baseline classifies it `02-deadcode:module-test-only`
  (`scripts/audit/baseline.json:30`).
- **Problems.** Dead code with a live-looking test suite; the directive's "flow-engine deletion"
  (§17 E9) points here (target concept 11 reconciliation).
- **Graph deps.** None in production; only test-import edges.
- **Disposition/rationale.** **Remove** — verified zero production consumers by both static and
  name-string search; the *live* flow capability is `lib/workflows/` (C3), which is retained. This
  is the one clean subsystem removal.
- **Migration.** None — no production behavior to carry.
- **Deletion criteria (the "carry your cleanup" invariant).**
  (1) Delete `lib/flows/` (9 files) and `lib/orchestration/delegation-flow.mjs`.
  (2) Delete the ~11 test files that exist *only* to exercise them: `tests/flows-engine`,
  `flows-define`, `flows-state`, `flows-checkpoint`, `flows-schema`, `flows-demo`,
  `tests/functional/flow-join-resume`, `flow-checkpoint-resume`,
  `tests/orchestration-delegation-flow`, and the delegation-flow imports in
  `orchestration-route-path`/`orchestration-policy` (rewrite those two if they assert live
  routing behavior independent of the flow).
  (3) Remove the `02-deadcode:…delegation-flow.mjs` allowlist entry from
  `scripts/audit/baseline.json` (mirrors the X3 codemod-deletion pattern: the gate entry dies
  with the code).
  (4) Remove the `delegation-flow` mention from `lib/flows/checkpoint.mjs:151` header if that file
  is being deleted anyway.
  (5) Gate: `npm run test:unit` and `construct doctor` green after removal; `grep -rn "lib/flows\|delegation-flow"` returns zero non-historical hits.

## Cluster D — Providers, models, memory

### D1s. Providers + contract adapters (`lib/providers/contract/*`) — **retain**
- **Purpose.** Per-provider adapters (github/jira/confluence/slack/…) each with
  `governed-write.mjs`; registry + adapter-factories; credential bootstrap/resolver/audit.
- **Current use.** Load-bearing; `adapter-factories.mjs` is one of the 8 control-plane importers.
- **Problems.** Adapter count vs the directive's ≤2 first-party direct-integration cap (§13).
- **Graph deps.** `provider`/`tool` nodes; `governed_by`/`secures` edges.
- **Disposition/rationale.** Retain the adapter *framework* (it is exactly the "behind an adapter"
  shape the directive wants), but hold new adapters to the ≤2 direct-integration cap; most
  Sources arrive behind adapters (target concept 2).
- **Migration.** Keep; enforce the adapter cap at the E5/E6 boundary; route governed-writes
  through the single E6 chokepoint (D1/A4).
- **Maintenance budget.** **High** — driver: provider API churn is the directive's named worst
  case (§13 "providers/products will change"); each adapter is ongoing external maintenance.

### D2s. Model-router / provider-invocation loop (`lib/model-router.mjs` + model-policy/tiers/…) — **replace**
- **Purpose.** `model-router.mjs` (the bespoke invocation/routing loop) + model-policy, model-tiers,
  model-free-selector, model-cheapest-provider, model-pricing; `model-registry.mjs` a 501-byte stub.
- **Current use.** One of the hottest modules — `model-router` is referenced by ≥16 modules (truth
  map §7; grep of files referencing the name on this branch returns 25, a looser file-count than
  the truth map's anchored-import count, but the same "very hot" direction).
- **Problems.** Directive delegates "model invocation/routing" to runtimes (§3) and §17 E9 lists
  "model-provider loop deletion." Construct owning a bespoke routing loop contradicts the target.
- **Graph deps.** Re-exports `resolveProviderCapabilities*` from the legacy `.js` tier (b0nny.10);
  feeds capability profiles.
- **Disposition/rationale.** **Replace** — the *invocation/routing loop* is delegated to the E4
  runtime adapters (directive: Construct delegates model routing). But this is a **split**: the
  model **capability-tier/policy** metadata (`model-tiers`, `model-policy`, `model-pricing`) is
  **retained** and folds into Worker Profile's `model_tier` (target concept 10) — Construct still
  decides *which tier* a Profile needs; it stops owning *how* the call is routed.
- **Migration.** High-effort, E4-gated: migrate the ≥16 importers off the routing loop onto the
  runtime contract; keep tier/policy as Worker Profile inputs; retire `model-registry.mjs` stub.
- **Deletion criteria.** Delete `model-router.mjs`'s routing/dispatch path only after every
  importer resolves model invocation through an E4 runtime adapter and the tier/policy metadata
  has a Worker-Profile home; retain the legacy-`.js` capability files the router re-exports until
  their consumers (b0nny.10) are migrated too.
- **Maintenance budget.** N/A for the loop (replaced); the retained tier/policy metadata is
  **Low** (pricing/tier table updates).

### D3s. Legacy provider `.js` tier — **retain** (partial removal already done, b0nny.10)
- **Purpose.** `provider-capabilities-*.js` (6), `token-engine.js`+`token-estimator-*.js` (5),
  `cache-strategy-*.js` (5) — May-2026 `.js` generation.
- **Current use.** Load-bearing: `lib/models/execution-capability-profile.mjs:30` imports
  `provider-capabilities.js`; `prompt-composer.js` + `certification/prompt-budget.mjs` import
  `token-engine.js`; `cache-strategy-google.js`'s resolver has a passing W1 functional test
  (b0nny.10).
- **Problems.** `.js`/`.mjs` split; one base dispatcher (`cache-strategy.js`) has zero callers
  (b0nny.10 flagged for a narrow follow-up, not this program).
- **Graph deps.** `realizes` edges into `lib/models/`.
- **Disposition/rationale.** **Retain** — b0nny.10 already deleted the one dead family
  (`dispatch-batch.js`) and proved the other 15 files load-bearing. No further removal here.
- **Migration.** None; fold under D2s's runtime-contract migration as its consumers move.
- **Deletion criteria (residual only).** The `cache-strategy.js` base dispatcher's three dead
  exports (`annotatePrompt`/`estimateCacheableTokens`/`resolveCacheTTL`) remain a narrow
  follow-up bead scoped with the Gemini-caching roadmap owner (b0nny.10) — not swept here.
- **Maintenance budget.** **Low** — driver: per-provider capability/token table updates.

### D4s. Observation / entity memory (`lib/observation-store.mjs` + `entity-store.mjs`) — **retain**
- **Purpose.** The durable observation/entity store; MCP `memory_search`/`memory_add_observations`/
  `memory_create_entities`/`memory_recent`.
- **Current use.** Extremely hot — ≥16 anchored importers (truth map §8); 20 files reference it on
  this branch.
- **Problems.** Two coexisting retrieval paths (observation-store vs knowledge/RAG, D7); the vector
  backend (LanceDB) is baked into core (D5/audit part B) against directive §13 "no required vector
  database."
- **Graph deps.** `embed` nodes; feeds the graph's runtime-evidence and corpus seeders.
- **Disposition/rationale.** **Retain** the observation/entity *domain model* — it is the memory
  substrate the whole system reads. Directive delegates the *vector-store implementation* (§3), so
  the storage backend is de-cored (D6s below), not the model.
- **Migration.** Keep the store; put the vector backend behind an optional adapter (D6s); reconcile
  the two retrieval paths under one memory owner (D7).
- **Maintenance budget.** **Medium** — driver: embeddings-engine churn + the LanceDB dependency
  until it moves behind an adapter.

### D5s. Knowledge / RAG (`lib/knowledge/*`, 7 files) — **retain**
- **Purpose.** `knowledge_search`, rag, graph, research-store, synthesis, trends; vector store at
  `.construct/lancedb/`; `mcp/memory-bridge.mjs` bridges an external memory MCP.
- **Current use.** The second retrieval path (D7); backs `knowledge_search` + research artifacts.
- **Problems.** Overlaps observation-store (D7 — two memory/retrieval paths, no single owner).
- **Graph deps.** `graphrag-ask` functional test; reads the dependency graph.
- **Disposition/rationale.** **Retain** behind the search/retrieval strategy decision (directive
  §7); reconcile with observation-store so the two paths have one owner (D7) rather than
  competing.
- **Migration.** Keep; unify the memory/retrieval ownership (D7); ride the same
  vector-behind-adapter move as D4s.
- **Maintenance budget.** **Medium** — driver: RAG + external memory-MCP bridge churn.

### D6s. Vector store in core (LanceDB via `storage/vector-client.mjs`) — **replace**
- **Purpose.** `.construct/lancedb/observations_v1.lance`, machine-scoped (ADR-0066);
  embeddings engines in `lib/storage/embeddings-*.mjs`.
- **Current use.** The concrete vector backend for observation-store + knowledge.
- **Problems.** Directive §13 "no required vector database"; §17 E9 "vector-store removal from
  core." A required LanceDB dependency in core contradicts the sustainability constraints.
- **Graph deps.** Backs memory nodes; not a domain node itself.
- **Disposition/rationale.** **Replace** — move LanceDB behind an *optional* retrieval adapter so
  the core runs without a required vector DB; the memory *domain model* (D4s) is unaffected.
- **Migration.** Introduce a retrieval-adapter contract (E-memory); make LanceDB one adapter;
  provide a no-vector fallback (keyword/BM25) so embedded use needs no vector DB.
- **Deletion criteria.** Remove the hard LanceDB import from core only after the adapter contract
  lands and a no-vector path passes the memory tests; reconcile existing `.construct/lancedb/`
  data by re-indexing behind the adapter (no silent data loss).
- **Maintenance budget.** N/A in core once de-cored (moves to optional-adapter maintenance).

## Cluster E — Governance (D1/A4)

### E1g. Governed-write pipeline (`writes/control-plane` + `write-intent` + `envelope` + `sent-log` + `embed/approval-queue`) — **retain**
- **Purpose.** The integrated write pipeline: control-plane produces a writeIntent → ApprovalQueue
  → envelope (idempotency/dedup/retry/audit) → sent-log. 8 importers of control-plane incl. all
  provider governed-writes, broker, oracle directive-executor, embed drain, CLI approvals.
- **Current use — corrected (see narrowing 2).** These five modules are *layers of one pipeline*,
  documented in `control-plane.mjs`'s own header (lines 6–10, 34–36) — not five competitors.
- **Problems.** The pipeline is not yet *formalized* as the sole chokepoint; two satellites
  (MCP token-gate E2g, roles recorder in C4) still record approvals outside it.
- **Graph deps.** `policy`/`governs`/`authorizes` edges; the write chokepoint the change-impact
  gate leans on.
- **Disposition/rationale.** **Retain** — this *is* target concept 13 (Policy chokepoint). A4 is
  **supported**: the chokepoint substantially exists; the work is formalization + folding in the
  two satellites, not a rebuild.
- **Migration.** Declare control-plane the single governed-write path (E6); route the roles
  approval recorder (C4) and the MCP token-gate (E2g) into it; migrate any per-surface idempotency
  to the envelope.
- **Maintenance budget.** **Medium–High** — driver: it gates every external effect; test burden +
  no-skip-vars enforcement (CLAUDE.md).

### E2g. MCP destructive-gate (`mcp/destructive-approval` + `mcp/destructive-gate`) — **retain**
- **Purpose.** Out-of-band approval-token issue/consume in front of destructive MCP tools; the
  token is required to execute a provider write, which then routes through the same envelope.
- **Current use — corrected.** `destructive-approval.mjs` has 0 static importers; it is reached
  only via `destructive-gate.mjs:10` → `dispatch-envelope.mjs:16`. It is a token layer in front of
  the E1g pipeline, not a competing write path.
- **Problems.** Its token authority is not yet recorded in the control-plane authority model (A4
  "MCP-side couplings").
- **Graph deps.** `authorizes` edge into the envelope.
- **Disposition/rationale.** **Retain, reconcile** — keep the MCP token UX; record token issuance
  in the E6 authority model so there is one authority ledger.
- **Migration.** Wire `issueApprovalToken`/`consumeApprovalToken` to record through control-plane's
  authority store; no separate approval queue.
- **Maintenance budget.** **Low** — driver: MCP destructive-tool list upkeep.

## Cluster F — Telemetry, schedulers, org metaphor

### F1. Telemetry / evaluations (`lib/telemetry/*`, `lib/evals/*`, `mcp/tools/telemetry.mjs`) — **retain**
- **Purpose.** cxTrace/cxScore/sessionUsage/efficiencySnapshot; client/backends/otel-tracer/
  llm-judge/eval-datasets/skill-outcomes/rule-calls/hook-calls/team-rollup/backfill/ingest;
  traces under `.construct/traces/`.
- **Current use.** Load-bearing observability + the evaluation framework the directive §12
  requires.
- **Problems.** D9 dual-registration: `cx_trace` (eager, `server.mjs:306`) + `cx_trace_telemetry`
  (lazy, `server.mjs:305`) → same `cxTrace` module, two names + two safety entries + two defs.
- **Graph deps.** Runtime-evidence into the graph (`evidenced_by`).
- **Disposition/rationale.** **Retain** the telemetry/eval substrate (it is the directive §12
  measurement floor); **remove** only the redundant `cx_trace_telemetry` alias (D9, below).
- **Migration.** Keep; delete the alias; align trace storage with the E1 graph event outbox.
- **Maintenance budget.** **Medium** — driver: otel + eval-dataset churn + trace-firehose volume
  (audit-trail 3.5MB observed).

### F2. Schedulers — **retain** (both Construct-owned)
- **Purpose / current use — corrected (see narrowing 3).** Two Construct schedulers, not three:
  `lib/scheduler/` (native launchd/systemd triggers + a live `construct scheduler` CLI command,
  4 tests, ADR-0077 — keep per b0nny.9) and `lib/embed/scheduler.mjs` (interval, 20 register
  sites in the embed daemon). The "scheduled-tasks MCP" is an external environment tool with zero
  Construct code references.
- **Problems.** The two Construct schedulers have distinct job sets but overlapping concepts
  (D2 — cron-native vs interval); `lib/scheduler/solo.mjs`'s `registerNativeTrigger`/
  `removeNativeTrigger` are dead-but-exported (b0nny.9 secondary finding).
- **Graph deps.** Scheduler jobs drive doc-hygiene, optimize-loop, rollups.
- **Disposition/rationale.** **Retain both** — each has real callers and tests (b0nny.9). Optional
  future reconciliation: unify under one scheduling abstraction, but that is a *reconcile*, not a
  removal, and D2 severity is narrowed (external MCP excluded).
- **Migration.** Keep; either wire `registerNativeTrigger`/`removeNativeTrigger` into a
  `construct scheduler install|uninstall` (with the directive's mandatory uninstall path) or delete
  those two dead exports in a narrow follow-up (b0nny.9's secondary finding).
- **Deletion criteria (the two dead exports only).** `registerNativeTrigger`/`removeNativeTrigger`
  removable after confirming zero callers (already true per b0nny.9) and deciding not to expose a
  native-install command; if kept, they need an uninstall path per program rule 2.
- **Maintenance budget.** **Low** each — driver: cron/interval job registration; OS-trigger
  support if native install is exposed.

### F3. Org metaphor — specialists/org + personas + teams + scopes — **replace**
- **Purpose.** `specialists/org/` (contracts, frameworks, groups, policies, scopes, specialists,
  teams — 8 teams, 4 scopes), `personas/*.md`, the fixed role roster.
- **Current use.** Drives persona selection, handoff contracts, team assembly; the "organization
  simulation" surface.
- **Problems.** Directive §3/§19 discards the organization *metaphor*; §17 E9 lists
  "specialist/persona/team deletion"; intent verdict names personas/roles/teams-as-fixed-structure
  as what diluted the intent.
- **Graph deps.** `specialist` node type (→ `worker profile`, concept 10); `owned_by` edges;
  `specialists/org/contracts/` postconditions enforced on handoffs (CLAUDE.md).
- **Disposition/rationale.** **Replace** — collapse persona/role/specialist/team into Worker
  Profile (target concept 10: "a Profile is a flow + skill emphasis"). The **handoff
  contracts** (`specialists/org/contracts/`) and **Capabilities** (`registry/capabilities.json`)
  are the load-bearing parts and are *retained* (target concept 12); the *metaphor scaffolding*
  (teams, groups, separate persona identities) is what's replaced/removed.
- **Migration.** Follow the profile lifecycle (CLAUDE.md, `profile-lifecycle.md`): migrate the 4
  scopes into Worker Profiles; fold personas into skill-emphasis inputs; retire teams/groups as
  fixed structure (parallelism becomes a Plan property, directive §10, not a team). Keep contracts.
- **Deletion criteria.** Delete `specialists/org/teams/` and `groups/` only after Plans express
  parallelism (directive §10) and no flow references a team; migrate `scopes/*.json` to Worker
  Profiles before deleting; regenerate platform files via `construct sync` so deleted personas
  leave no generated residue (program rule 2). Retain `contracts/` and `capabilities.json`.
- **Maintenance budget.** N/A (replaced); the retained contracts/capabilities are **Low–Medium**.

---

# Duplication reconciliation (D1–D9)

Each duplication maps onto the primary-matrix verdicts above; this table is the cross-cutting
migration/cleanup view, not additional subsystems.

| # | Duplication | Verdict path | Deletion / reconciliation |
|---|---|---|---|
| D1 | Approval/authority surfaces (narrowed, A4) | E1g **retain** (chokepoint) + E2g **retain, reconcile** + roles `approval-surface` **replace** (C4) | Formalize control-plane as sole chokepoint; fold MCP token-gate authority + the one roles recorder into it; then delete `roles/approval-surface.mjs`. Severity narrowed High→Medium. |
| D2 | Schedulers (narrowed to 2) | F2 **retain both** | External scheduled-tasks MCP excluded (zero code refs); optional reconcile of native-vs-interval; remove/annex the two dead `solo.mjs` trigger exports. |
| D3 | Oracle vs embed daemons | B1 **retain** (embed) + B2 **replace** (oracle) | Consolidate into one overseer; migrate directive-execution→E5, reconciliation→E1; delete oracle daemon-entry + oracle-liveness watcher; reconcile `.construct/oracle/` state. |
| D4 | Routing layers | C1 **retain** (orchestration routing) + C4 **replace** (roles router) | Fold `roles/router`+`gateway` into `orchestration/routing-tables`; delete after oracle/overseer route through it. |
| D5 | Run-store backends (no shared migration) | C2 **rebuild** | Versioned migration files for the inline SQLite schema; backend-parity test; delete the inline `CREATE TABLE` path. |
| D6 | Project-identity ×3 | **remove** 2 of 3 → Workspace identity (concept 1) | Keep `deriveProjectKey` (git-remote hash) canonical; rewrite `orchestration/store.projectKey` + `embed/daemon.resolveRootDir` to read it; assert one id across all three (the existing `cross-process-state-has-one-authoritative-location` invariant); reconcile any state under divergent keys. |
| D7 | Memory/retrieval paths | D4s + D5s **retain**, one owner | Reconcile observation-store vs knowledge/RAG under a single memory owner; no code deleted, ownership unified. |
| D8 | `.construct` vs `.cx` naming residue | **remove** the residue | Rewrite `.cx`/`~/.cx` docstrings + solo paths (graph-store comments, approval-queue solo path, recommendation-store) to `.construct`; confidence medium on which are genuinely divergent vs aliased — verify each before edit. |
| D9 | `cx_trace_telemetry` alias | **remove** | Delete the alias's 3 sites: `tool-safety.mjs:82`, `server.mjs:305`, `tool-definitions-workflow.mjs:271`; keep `cx_trace`. Gate: MCP surface-parity + tool-budget tests green. |

# Deletion candidates (X1–X5)

| # | Candidate | Status this branch | Verdict |
|---|---|---|---|
| X1 | `lib/flows/` + `delegation-flow.mjs` | Confirmed dead by static + name-string search + repo baseline | **remove** (C5) — with the ~11-test-file + baseline-allowlist cleanup as deletion criteria |
| X2 | `.bak` files (`policy/engine.mjs.bak`, `roles/manifest.mjs.bak`) | **Not present** in this worktree (primary-checkout debris only) | remove — n/a here; left to the primary checkout's owner |
| X3 | `patch-registry-readers-v2.mjs` codemod | Already removed Wave 0 (with its allowlist line) | done |
| X4 | `lib/scheduler/` | Keep per b0nny.9 (live CLI command confirmed on this branch, `cli-commands.mjs:1180`) | **retain** (F2) — truth map "orphaned" overturned |
| X5 | Legacy provider `.js` tier | Split per b0nny.10: `dispatch-batch.js` removed; 15 files load-bearing | **retain** (D3s) — one family removed, rest kept |

---

# Replacement strategy (directive §14.15)

Per the directive's vocabulary (in-place **evolution** / compatibility-backed / parallel
**next-generation** / **direct** replacement / **hybrid**), assigned per cluster:

| Cluster | Strategy | Why |
|---|---|---|
| Surfaces (CLI, MCP, ACP, hooks, launcher) | **In-place evolution** | Load-bearing, close to target shape; risk of a parallel rebuild outweighs benefit. Prune commands/aliases in place. |
| Governed writes (E1g/E2g) | **In-place evolution** (formalize) | The chokepoint substantially exists (A4 narrowed); formalize + fold satellites, don't rebuild. |
| Graph substrate (run-store C2; separately the graph store owned by b0nny.2) | **Rebuild in place** (storage shape) | Capability sound, substrate wrong (JSONL/inline-SQLite → relational/versioned); port-and-extend, not parallel. |
| Daemons (D3) | **Hybrid** | Retain embed as survivor (evolution); replace Oracle by migrating its jobs then deleting the entity (direct, gated on job-migration tests). |
| Roles + org metaphor (C4, F3) | **Parallel next-generation → direct cutover** | Build Worker Profile + orchestration-routing target beside the roles/org layer, cut over, then delete the metaphor. Preserve `event-bus` + contracts across the seam. |
| Model/provider loop (D2s) | **Parallel next-generation** (E4-gated) | Build the runtime-adapter invocation path beside `model-router`, migrate the ≥16 importers, then delete the loop. Highest-risk seam; keep tier/policy metadata. |
| Memory backend (D6s) | **Compatibility-backed** | Introduce the retrieval-adapter contract with LanceDB as one adapter + a no-vector fallback, so core keeps working while the vector DB is de-cored. |
| Dead flow engine (C5/X1) | **Direct removal** | No production behavior to preserve; delete with its tests + gate entry. |

**Permanent components:** CLI, MCP, launcher, workflow engine (→Procedure), observation/entity
memory model, governed-write pipeline, telemetry/eval substrate, provider-adapter framework,
handoff contracts + capability registry, the (b0nny.2-owned) graph store.
**Temporary adapters / transitional compatibility:** LanceDB retrieval adapter (until no-vector
fallback proven), the runtime-adapter shim during the model-loop migration, the roles→routing and
persona→Worker-Profile bridges during cutover.
**Migrated data:** run-store SQLite schema→migrations; `.construct/oracle/` state→E5/E1;
`specialists/org/scopes/`→Worker Profiles; personas→skill emphasis; divergent project keys→one
Workspace id; `.construct/lancedb/`→re-indexed behind the adapter.
**Discarded data:** none silently — every migration above reconciles; the only outright deletions
are dead code (`lib/flows/` + its tests), the `cx_trace_telemetry` alias, `.cx` residue, and (once
migrated) the two divergent identity derivations and roles/org scaffolding.
**Removed commands/services:** deprecated `matrix` alias; orphaned CLI commands (E9 audit);
Oracle daemon; `orchestration_delegation_next` (already gone).

## Cleanup milestones

1. **M0 — free removals (no dependency):** delete `lib/flows/` + delegation-flow + their tests +
   baseline allowlist entry (X1/C5); delete `cx_trace_telemetry` alias (D9); fix `.cx` residue
   (D8). All are zero-production-impact and gated only by the test suite + doctor.
2. **M1 — identity + persistence (E1/E2 foundations):** converge the three project-identity
   derivations on one Workspace id (D6); give the SQLite run-store versioned migrations + parity
   test (D5/C2).
3. **M2 — governance formalization (E6):** declare control-plane the sole chokepoint; fold the MCP
   token-gate + roles recorder in; then delete `roles/approval-surface` (D1/A4).
4. **M3 — routing + daemon consolidation (E5):** fold `roles/router`+`gateway` into orchestration
   routing (D4); migrate Oracle's jobs into the embed-based overseer; delete the Oracle entity
   (D3/B2).
5. **M4 — org-metaphor cutover (E4/E5):** migrate scopes→Worker Profiles, personas→skill emphasis,
   parallelism→Plan property; retire teams/groups; `construct sync` to clear generated residue (F3).
6. **M5 — model-loop + vector de-core (E4 + memory):** migrate model invocation onto runtime
   adapters, delete the routing loop (D2s); put LanceDB behind an optional adapter with a
   no-vector fallback (D6s).

## Point of no return

The program's point of no return is **the start of M3 (routing + daemon consolidation)**. M0–M2
are individually reversible: dead-code deletion, an alias removal, a residue rename, an identity
convergence, and added migration files can each be reverted by `git revert` with no state loss,
because nothing durable is discarded and no external effect changes. From M3 onward the Oracle
entity is deleted and the roles routing is folded away — after that, reverting means re-standing-up
a deleted daemon and its `.construct/oracle/` state contract, which is materially harder than a
revert. Concretely: **do not begin M3 until (a) the E5 workplace-loop and E1 reconciliation carry
Oracle's jobs with green equivalence tests, and (b) the D1/A4 chokepoint (M2) is proven to have
zero write-path bypass.** M5's model-loop deletion is a second, narrower point of no return, gated
on the E4 runtime-adapter conformance suite (directive §11 F) passing.

## Rollback plan

- **M0–M2 (pre-PONR):** `git revert` per milestone. Run-store migrations are additive (version 1
  reproduces the current inline schema), so reverting the migration files leaves data readable by
  the old inline path. Identity convergence (D6) keeps `deriveProjectKey` as the canonical it
  already is, so revert is a no-op on stored keys.
- **M3 (daemon/routing):** keep the Oracle daemon-entry and roles router **behind a feature seam**
  (not a skip env var — a config-declared overseer/routing selection consistent with the repo's
  no-skip-vars stance) for one release after cutover, so rollback re-selects the old overseer
  without redeploying deleted code. Reconcile `.construct/oracle/` state on both directions.
  Delete the seam + the old code only in the *following* release once the consolidated overseer has
  run clean in production (directive §11 F "existing runs finish safely").
- **M4 (org metaphor):** Worker Profiles are authored *beside* the scopes/personas before deletion;
  rollback re-points selection at the retained scope files until the profiles are validated
  (profile lifecycle). No persona data is deleted until migrated.
- **M5 (model loop / vector):** the runtime-adapter path ships in parallel with `model-router`; a
  config-declared runtime selection lets a bad adapter roll back to the bespoke loop for one
  release. The LanceDB adapter ships with the no-vector fallback already green, so de-coring the
  vector DB is reversible by re-selecting the LanceDB adapter; `.construct/lancedb/` data is
  re-indexed, never dropped.
- **Whole-program backstop:** every milestone is a wave/bead with its own `construct doctor` +
  `npm run test:unit` gate; the program branch is a worktree off `feat/workspace-control-plane`
  and is never merged to `main` without the full nine-check gate (CONTRIBUTING.md). No milestone
  deletes an installed trigger (hook, launchd/systemd) without shipping its uninstall path
  (program rule 2).

---

# Maintenance budget summary (directive §14.14)

Estimates in maintainer-days/month for **retained** subsystems (replaced/removed ones drop to
zero once cutover completes). Bands per directive §13 dimensions; these are qualitative
estimates, not measured figures. The directive's **≤2 d/mo total** ceiling is the pressure behind
the five replace verdicts — the current retained set already trends toward the ceiling, which is
why the org metaphor, model loop, Oracle, and vector-in-core are pushed out rather than kept.

| Subsystem | Band | Dominant cost driver (§13) |
|---|---|---|
| CLI | Medium | command-count churn, help/doc upkeep |
| MCP server | High | protocol churn (MCP + Tasks), per-tool safety, surface parity |
| ACP server | Low–Medium | ACP protocol churn |
| Hooks (41) | High | 41 session-blocking surfaces, test burden, edit-with-care |
| Launcher | Low | resolver-tier drift |
| Embed daemon (survivor) | High | ~11 job families, provider maintenance, OS supervision |
| Doctor watchers | Low–Medium | one watcher per pipeline |
| Orchestration runtime | Medium–High | host-sampling loop, gate logic, run lifecycle |
| Run-store (post-rebuild) | Medium | schema-migration burden across 2 DB engines |
| Workflow engine (Procedure) | Low–Medium | manifest-schema + surface-parity tests |
| Provider + contract adapters | High | provider API churn (the §13 named worst case) |
| Legacy `.js` tier (retained 15) | Low | per-provider capability/token tables |
| Observation/entity memory | Medium | embeddings-engine churn (until vector de-cored) |
| Knowledge/RAG | Medium | RAG + external memory-MCP bridge |
| Governed-write pipeline | Medium–High | gates every external effect, no-skip-vars enforcement |
| MCP destructive-gate | Low | destructive-tool list upkeep |
| Telemetry / evals | Medium | otel + eval-dataset churn, trace-firehose volume |
| Schedulers (2) | Low each | cron/interval job registration |
| Handoff contracts + capabilities (retained from org) | Low–Medium | contract postcondition upkeep |

**Reading:** the High-band retained subsystems (MCP, hooks, embed daemon, provider adapters,
governed writes) are the irreducible core of a governance control plane and are where the ≤2 d/mo
budget is mostly spent; the replace/remove verdicts exist to keep that total under the ceiling by
retiring the metaphor and provider-loop maintenance that would push it over.

# What this document deliberately does not do

- It does **not** design the graph store or fix the ~35-type ontology — that is `construct-b0nny.2`
  (E1). It consumes the b0nny.1 concept mapping and the b0nny.9/.10 keep-verdicts.
- It does **not** run the validation spikes (directive §11) — those are `construct-b0nny.5` and
  gate the E4-dependent verdicts (model loop, ACP, runtime adapters) and the A1 relational-graph
  assumption.
- It does **not** file the executable bead program — that is `construct-b0nny.6`. This matrix's
  milestones and deletion criteria are inputs to that DAG, not the beads themselves.
- It does **not** touch the primary checkout's `.bak` debris (X2) or run any remote-mutating
  command; all verdicts are evidence + local reasoning on the `chore/b0nny.4-disposition-matrix`
  worktree.
