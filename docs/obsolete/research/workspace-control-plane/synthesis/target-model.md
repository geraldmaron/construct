---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Target Conceptual Model — Workspace Control Plane

Authored 2026-07-17 by the Wave 1 lead (bead `construct-b0nny.1`, epic `construct-b0nny`).
Single-lead, no fan-out per [subagents/routing-plan.md](../subagents/routing-plan.md) and the
program charter. This document advances directive outputs **14.8** (target product model),
**14.9** (target conceptual model), and seeds **14.11** (target work schemas). It does **not**
design the graph store (that is `construct-b0nny.2`) or the disposition matrix
(`construct-b0nny.4`); it stays in the concept/schema lane and hands those epics a settled
vocabulary.

Inputs read in full: [directive.md](../directive.md) §4/§8/§9,
[synthesis/consolidated-findings.md](consolidated-findings.md) (D1–D9, X1–X5, A1–A5, intent
verdict), [program.md](../program.md) operating rules,
[baseline.md](../baseline.md), [subagents/graph-and-state-audit.md](../subagents/graph-and-state-audit.md).

Every load-bearing repo claim below was re-verified against the worktree at
`feat/workspace-control-plane` @ `adeff6d9` (cut from `main` @ `0dcb33c3`); paths cited are
confirmed present unless marked `unverified`. Naming follows program rule 1: concepts are named
for capability, never for a product generation — no `v2`/`next`/`new-` names appear here. Where
the directive's glossary term carries the word "version" (Work Specification **version**, Plan
**version**), that word denotes the concept's immutable-versioning discipline, not a generation
label; the concept is named for its role and the versioning is stated as a lifecycle property.

## Method & verdict legend

The directive's §8 glossary names 18 concepts. Each is judged against Wave 0 evidence and the
existing codebase, then assigned exactly one verdict:

- **keep** — the concept is sound and distinct; retained as a first-class domain object. May
  still be *new to the codebase* (no store exists yet) — "keep" is a verdict on the concept, not
  a claim that it is already built.
- **merge** — retained, and it absorbs one or more existing duplicate/scattered repo systems
  into a single owner, collapsing synonyms surfaced by Wave 0's D-inventory.
- **replace** — the directive's framing is refined so the *realized shape* differs from how the
  repo treats it today (e.g. demoted from standalone record to a relationship, or from domain
  model to projection adapter).

No concept was rejected outright — Wave 0 found nothing contradicting the hypothesis
([consolidated-findings.md](consolidated-findings.md) intent verdict), so the directive's
factoring survives; the work is mapping, consolidation, and two demotions, not replacement of
the ontology.

## Verdict summary (all 18)

| # | Concept | Verdict | Maps onto / consolidates | Assumption gate |
|---|---|---|---|---|
| 1 | Workspace | keep | new top-level scope; consolidates the D6 triple project-identity derivation | — |
| 2 | Source | merge | `lib/sources/`, `lib/ingest/`, `lib/config/source-target-registry.mjs`, `lib/embed/auto-sources.mjs` | — |
| 3 | Objective | keep | new durable object (only STRATEGY.md prose today) | A6 |
| 4 | Directive (standing) | keep | `lib/directives/`, `lib/oracle/directive-executor.mjs`, `lib/cli/directives.mjs` | A7 |
| 5 | Work | keep | new aggregate root; the unit a tracker projects | A6 |
| 6 | Work Specification | keep | new versioned agreement record | — |
| 7 | Plan | keep | new versioned approach record; distinct from Procedure | — |
| 8 | Run | keep | `lib/orchestration/run-store*.mjs`, table `orchestration_runs` | — |
| 9 | Assignment | keep | `queue_items`+`claims`, `workers` (`lib/db/migrations/00{2,3}_*.sql`) | — |
| 10 | Worker Profile | merge | personas/roles/specialists/teams/scopes org metaphor → `lib/scopes/`, `specialists/org/scopes/` | — |
| 11 | Procedure | merge | live `lib/workflows/` + `lib/embedded-contract/workflow-defs.mjs`; **not** dead `lib/flows/` | — |
| 12 | Capability | keep | `registry/capabilities.json`, `specialists/org/contracts/` | — |
| 13 | Policy | merge | 5 approval/authority surfaces (D1) → one chokepoint at `lib/writes/control-plane.mjs` | A4 |
| 14 | Artifact | keep | new content-identity record (artifacts produced across runs today) | — |
| 15 | Evidence | replace | demoted from standalone concept to a relationship; reconciles with existing `evidenced_by` edge | A8 |
| 16 | Projection | replace | Beads reframed from domain model to projection adapter (`lib/beads-client.mjs`) | A5 |
| 17 | Graph node | keep | `lib/graph/store.mjs` node model (16 types → ~35); representation layer, not a source of truth | A1, A2 |
| 18 | Graph edge | keep | `lib/graph/store.mjs` edge model (16 rels → ~30); inferred-vs-declared preserved | A1, A2 |

Count: 12 keep, 4 merge, 2 replace.

## Synonym & overlap analysis (rejections and rulings)

The directive's own list is already largely de-duplicated, so the sharpest synonym risk is
between *adjacent* directive concepts and between a directive concept and the repo's duplicated
systems. Each risky pair was ruled on explicitly; the ruling is the "distinct because" that §8
requires.

| Pair | Risk | Ruling |
|---|---|---|
| Objective ↔ Work | "the thing being done" | **Distinct.** Objective = durable intent (result + why), can outlive and spawn many Works. Work = one bounded, owned, tracker-projected unit that advances exactly one Objective. Cardinality logged as **A6**. |
| Objective ↔ Directive | both express "what we want" | **Distinct.** Objective is a finite result with an end state. Directive is a *standing* generator that keeps emitting Objectives/Work while active (e.g. "keep dependencies patched"). |
| Directive ↔ Policy | both constrain behavior | **Distinct.** Directive *produces* work; Policy *governs* whether an effect is allowed and what approval it needs. A Directive can only act *through* Policy at the mutation boundary. Logged as **A7**. |
| Work Specification ↔ Plan | both are versioned work docs | **Distinct.** Spec = the *what/why* agreement (problem, outcome, acceptance, constraints), stable across approaches. Plan = the *how* (decomposition, assignments, runtime, parallelization), one Spec → many Plans. |
| Plan ↔ Procedure | both describe a sequence of steps | **Distinct.** Plan is one-off, for one Work, chosen by a planner. Procedure is a reusable, named, versioned deterministic template invoked by many Plans. |
| Assignment ↔ Run | both are "execution" | **Distinct.** Run = one attempt at a whole Plan. Assignment = one typed unit within that Run handed to one worker. One Run contains many Assignments. |
| Worker Profile ↔ Capability | both describe "what a worker can do" | **Distinct.** Capability = a typed operation the *system* can perform (contract). Worker Profile = the *configuration* (runtime + model tier + skill emphasis + flows) of a worker that may be assigned to exercise capabilities. |
| Artifact ↔ Evidence | both concern produced outputs | **Distinct — and Evidence is demoted.** Artifact = a content-identified output (node). Evidence = the *assertion* that an Artifact satisfies a requirement/acceptance criterion (edge). See verdict **replace** on Evidence. |
| Graph node ↔ every domain concept | every domain object is "a node" | **Distinct — the key non-duplication rule.** A Graph node is a *representation/index* of a domain object with provenance, confidence, and lifecycle metadata. The domain store is the source of truth; the graph never becomes authoritative (directive §4: "model-generated claims never become authoritative without evidence"). Collapsing them would recreate the dual-source-of-truth failure D6 warns about. |

Repo-level synonyms that the directive concepts *absorb* (the "merge" verdicts) are the D1–D9
duplications from [consolidated-findings.md](consolidated-findings.md): D1→Policy, D6→Workspace
identity, the scattered source subsystems→Source, personas/roles/specialists/teams→Worker
Profile, and the two "flow" systems split by Procedure (live `lib/workflows/` kept, dead
`lib/flows/` excluded per reconciliation 1).

---

# The 18 concepts

Each entry defines: **Meaning**, **Distinct from** (why no existing concept suffices),
**Source of truth**, **Owner**, **Lifecycle**, **Enforcement**, **Extension**, **Tests**,
**Migration**, **Deletion behavior**, **Graph representation**, plus a target **Schema** and an
illustrative **Example**. Schemas describe the target shape; where the store does not exist yet
this is stated. Examples are illustrative unless grounded in a cited file.

## 1. Workspace — *keep*

**Meaning.** The top-level scope that owns everything else: one Workspace is one governed
context (one repo, one product, or one team's operating surface) with a single canonical
identity, one authority boundary, and one set of durable stores. Every other concept is scoped
to exactly one Workspace.

**Distinct from.** No existing concept — today "workspace" is *implicit*, derived three
incompatible ways (D6: `deriveProjectKey`, orchestration `projectKey`, embed
`resolveRootDir`), which is precisely why state can land under different keys. Making it a
first-class object with one id resolves that duplication.

**Source of truth.** A `workspaces` record (target; does not exist yet) holding the canonical
id and the resolution inputs (git remote, root path, config name) that the three current
derivations disagree on. The workspace id becomes the scope key on every other store.

**Owner.** A workspace-identity subsystem (target E2 "workspace domain"), replacing
`lib/state-root.mjs`'s `deriveProjectKey`, `lib/orchestration/store.mjs`'s `projectKey`, and
`lib/embed/daemon`'s `resolveRootDir` (D6, ADR-0092, bead `construct-36w10`).

**Lifecycle.** `provisioning → active → archived`. Archived retains data read-only; there is no
hard-delete of an active workspace with live Work.

**Enforcement.** An invariant that all three identity derivations return the same id
(the existing `cross-process-state-has-one-authoritative-location.mjs` invariant is the seed,
cited in the audit part B). Schema-level: workspace id is a non-null foreign scope on every
domain table.

**Extension.** New deployment modes (embedded/shared) are the same Workspace concept with
different *storage bindings*, not new scope types — the directive requires "one product model
across embedded and shared deployments" (§19). A new Source, Objective, or Policy attaches to a
Workspace without changing the Workspace schema.

**Tests.** Assert one workspace id across all three derivations for a fixture repo; assert every
domain record carries a resolvable workspace scope; assert two co-located checkouts of the same
remote resolve to the same Workspace (the D6 failure mode).

**Migration.** Backfill: for each existing `.construct/` state root, mint one Workspace, adopt
the git-remote-hash key as canonical, and rewrite the two divergent derivations to read it.
No shared→local authoritative fallback (directive §13).

**Deletion behavior.** Archiving a Workspace tombstones it and cascades read-only; a purge is a
separate, explicit, out-of-band operation that removes all scoped stores together (clean
uninstall, directive §13).

**Graph representation.** Node type `workspace` (new; directive §4 ontology). It is the root
scope on every other node via a `workspace` scope field rather than an edge to avoid 1:N edge
explosion; cross-workspace edges are disallowed.

**Schema (target — not yet implemented).**
```
Workspace {
  id            string   # canonical, from git-remote hash; stable
  name          string
  root_path     string   # local checkout root
  remote        string?  # canonical remote url, null for local-only
  deployment    enum(embedded, shared)
  state         enum(provisioning, active, archived)
  created_at    ts
  archived_at   ts?
}
```
**Example (illustrative).** `{ id: "ws_construct_a1b2", name: "construct",
root_path: "/Users/…/construct", remote: "github.com/…/construct", deployment: embedded,
state: active }` — the single identity the three current derivations would converge on.

## 2. Source — *merge*

**Meaning.** An external system that feeds signals into the Workspace (GitHub, Jira, Slack,
Confluence, a filesystem content root, the Beads tracker). A Source is declared once, monitored,
and normalized into internal signals that can raise Objectives or Work — it is the *inbound*
boundary.

**Distinct from.** Not a Capability (which is an operation the system performs) and not a
Projection (the *outbound* representation to a tracker). Today the inbound side is scattered:
`lib/sources/` (content-roots, repo-cache), `lib/ingest/` (extraction strategies),
`lib/config/source-target-registry.mjs`, `lib/embed/auto-sources.mjs`,
`lib/doctor/watchers/source-targets.mjs` — five places with no single Source object. The merge
gives them one owner.

**Source of truth.** A `sources` registry per Workspace (consolidating
`source-target-registry.mjs`), each row carrying kind, connection reference (never the
credential itself — directive §13 scoped credentials), and last-sync cursor.

**Owner.** A source subsystem (target E5 "sources, directives, and workplace loop"), absorbing
the five scattered modules above.

**Lifecycle.** `declared → connected → syncing → active → paused → removed`. `error` is a
transient state on `active`, not a terminal one.

**Enforcement.** Signal ingestion must be idempotent and cursor-based (no duplicate signals on
re-sync); a health watcher (the existing `lib/doctor/source-target-health.mjs` is the seed)
asserts each active Source is reachable. No fabricated activity when a sync yields nothing
(directive §11 D).

**Extension.** A new Source kind is a new adapter behind a stable ingestion contract — the
directive caps first-party *direct integration* adapters at ≤2 (§13), so most Sources arrive
behind an adapter, not as core code.

**Tests.** Assert re-syncing an unchanged Source produces zero new signals (idempotency); assert
a Source outage degrades to `error` without dropping the cursor; assert credentials never land
in the `sources` row.

**Migration.** Fold `source-target-registry` rows and `auto-sources` config into the `sources`
table keyed by Workspace; keep raw ingested records (directive §14.16 "raw-record
preservation").

**Deletion behavior.** Removing a Source stops sync and tombstones its cursor; already-ingested
signals and any Work they raised persist (provenance must survive the Source that produced it).

**Graph representation.** Node type `source` (directive §4). Edge `sourced-from`
(Objective/Work `sourced-from` Source) records provenance of internally-raised work — the
directive's §4 `sourced-from` edge.

**Schema (target).**
```
Source {
  id, workspace   string
  kind            enum(github, jira, slack, confluence, filesystem, beads, …)
  connection_ref  string   # handle into scoped-credential store, never the secret
  cursor          json     # last-sync position, per-kind shape
  state           enum(declared, connected, syncing, active, paused, error, removed)
  last_synced_at  ts?
}
```
**Example (illustrative).** `{ kind: "github", connection_ref: "cred:gh_construct",
cursor: {last_event_id: "…"}, state: active }` raising a Work when a CI failure signal arrives.

## 3. Objective — *keep*

**Meaning.** A durable statement of a desired result and *why* it matters. It is the strategic
anchor that Work advances; it has an end state (met / abandoned) and can be sourced from a human,
a Source signal, or a standing Directive.

**Distinct from.** Not Work (a bounded unit that pursues it) and not a Directive (a standing
generator). Confirmed *new*: a code search for an `objective` concept returns nothing today —
objectives live only as prose in `STRATEGY.md`. The intent verdict names Construct's northstar
as durable organizational intent that accumulates; Objective is where that intent becomes a
queryable record.

**Source of truth.** An `objectives` record per Workspace (target; does not exist).

**Owner.** The workspace domain subsystem (E2/E5).

**Lifecycle.** `proposed → accepted → active → (met | abandoned) → archived`. Transition to
`met` requires linked acceptance Evidence (concept 15).

**Enforcement.** An Objective cannot be marked `met` without at least one Evidence relationship
to an accepted Artifact; abandonment requires a recorded rationale (no silent drops — evidence
discipline, program rule 4).

**Extension.** Objectives compose hierarchically (a parent Objective `contains` child
Objectives) rather than by adding new Objective subtypes; measurement attaches as optional
metric references, not schema forks.

**Tests.** Assert `met` is blocked without acceptance Evidence; assert an Objective survives
deletion of the Work that advanced it; assert a Source-raised Objective carries a `sourced-from`
provenance edge.

**Migration.** Seed initial Objectives from `STRATEGY.md` northstar/pillars as accepted records
(one-time, human-reviewed) rather than parsing prose at runtime.

**Deletion behavior.** Objectives are archived, never hard-deleted while Work references them;
archival cascades to close (not delete) dependent open Work with a supersession note.

**Graph representation.** Node type `objective` (directive §4). Edges: Work `realizes`
Objective; Objective `contains` sub-Objective; Objective `sourced-from` Source/Directive.

**Schema (target).**
```
Objective {
  id, workspace   string
  statement       string   # the desired result
  rationale       string   # why it matters
  parent          id?      # for hierarchy
  state           enum(proposed, accepted, active, met, abandoned, archived)
  met_evidence    id[]     # Evidence relationships required to reach `met`
  origin          {kind: enum(human, source, directive), ref: id?}
}
```
**Example (illustrative).** `{ statement: "One person runs a real software org from a single AI
interface", rationale: "STRATEGY.md northstar", state: active, origin: {kind: human} }`.

## 4. Directive (standing) — *keep*

**Meaning.** A persistent instruction that continuously generates Work or Objectives while it is
active — e.g. "keep dependencies patched", "triage every inbound security signal within a day".
Unlike an Objective it has no end state of its own; it is a *generator* that runs until retired.

**Distinct from.** Not a Policy (which governs whether an effect is allowed) and not a Source
(inbound external signals). A standing Directive already has a real, distinct home:
`lib/directives/directive-config.mjs`, `lib/oracle/directive-executor.mjs`,
`lib/cli/directives.mjs`. Whether it deserves a separate store from Policy/Source is logged as
**A7**.

**Source of truth.** A `directives` record per Workspace, consolidating `directive-config`.

**Owner.** The sources/directives/workplace-loop subsystem (E5); execution via the existing
`directive-executor` pattern.

**Lifecycle.** `draft → active → paused → retired`. A retired Directive stops generating but its
already-generated Work persists.

**Enforcement.** Directive-generated Work must carry provenance back to the Directive (no
fabricated activity — directive §11 D); a Directive can only cause an *external* effect through
Policy approval (concept 13), never directly.

**Extension.** New Directive behaviors are new *trigger + template* pairs behind the executor
contract, not new subsystems; a Directive references the Procedures/Capabilities it may invoke
rather than embedding logic.

**Tests.** Assert a paused Directive generates nothing; assert generated Work links back to its
Directive; assert a Directive cannot bypass Policy to mutate an external system.

**Migration.** Move `directive-config` entries into the `directives` table keyed by Workspace;
keep the `directive-executor` execution path (it is live, not dead).

**Deletion behavior.** Retiring a Directive tombstones the generator; generated Objectives/Work
persist with a "generator retired" note; any installed trigger (cron/native) gets an uninstall
path (program rule 2).

**Graph representation.** Node type `directive` (directive §4). Edges: Directive `sourced-from`
nothing (it is an origin); Objective/Work `sourced-from` Directive; Directive `governed_by`
Policy for its effects.

**Schema (target).**
```
Directive {
  id, workspace   string
  instruction     string
  trigger         {kind: enum(schedule, source_signal, manual), config: json}
  emits           enum(objective, work)
  procedures      id[]     # Procedures/Capabilities it may invoke
  state           enum(draft, active, paused, retired)
}
```
**Example (illustrative).** `{ instruction: "Patch dependencies weekly",
trigger: {kind: schedule, config: {cron: "weekly"}}, emits: work, state: active }`.

## 5. Work — *keep*

**Meaning.** The aggregate root and unit of ownership: a bounded pursuit of one Objective that
binds together its Work Specification versions, Plan versions, and Runs, and carries a single
lifecycle and owner. Work is the thing a tracker *projects* as an issue.

**Distinct from.** Not an Objective (durable intent) — Work is the finite, owned container that
advances it, and is the natural projection target (Beads issue, Jira ticket). §9 of the
directive lists the sub-parts (Spec/Plan/Run) but omits an explicit "Work" umbrella, while §4
lists `work` as a node type; the aggregate-root reading reconciles both. Cardinality (1 Work → 1
Objective; 1 Objective → N Work) is logged as **A6**.

**Source of truth.** A `work` record per Workspace (target). Its *canonical* fields are the
domain record; any tracker projection is downstream (concept 16).

**Owner.** The work-specification/planning subsystem (E3); the workspace domain owns its
lifecycle.

**Lifecycle.** `draft → specified → planned → running → integrating → (accepted | rejected) →
archived`. A parent Work reaches `accepted` only when integration and whole-system validation
succeed (directive §10).

**Enforcement.** The change-impact gate (directive §4): Work cannot reach `accepted` while
required dependents are unevaluated, required tests unrun, a referenced Capability disappeared,
a schema changed without migration disposition, or a deletion leaves active inbound dependencies.
This is the load-bearing enforcement — it binds Work completion to the graph.

**Extension.** Work composes via parent/child (subgraphs, directive §10 "nested subgraphs");
new work *shapes* (research vs code mutation) are expressed by their Plan's topology, not by new
Work subtypes.

**Tests.** Assert Work cannot be `accepted` with an unrun required test or an unevaluated
dependent (the change-impact gate); assert a parent Work stays open until all children integrate;
assert Work carries exactly one Objective link (A6).

**Migration.** Existing Beads issues become Projections *of* Work, not the Work itself (concept
16) — the domain record is authored fresh and the tracker item points at it.

**Deletion behavior.** Work is archived; a superseded Work records a `supersedes` edge to its
replacement (program rule 2 "cleaned up and reconciled, not abandoned"). Hard-delete only on
purge of the whole Workspace.

**Graph representation.** Node type `work` (directive §4). Edges: Work `realizes` Objective;
Work `contains` child Work; Work `supersedes` Work; Work `depends-on` Work (derived from the
graph, not narrative — directive §16).

**Schema (target).**
```
Work {
  id, workspace       string
  objective           id       # exactly one (A6)
  title               string
  parent              id?
  current_spec        id       # latest Work Specification version
  current_plan        id?      # latest Plan version, once planned
  state               enum(draft, specified, planned, running, integrating, accepted, rejected, archived)
  supersedes          id?
  impact_result       id?      # the change-impact record gating acceptance
}
```
**Example (illustrative).** `{ title: "Consolidate approval surfaces onto one chokepoint",
objective: "obj_single_authority_boundary", state: planned }` — the Work that would deliver D1.

## 6. Work Specification — *keep*

**Meaning.** The stable, versioned agreement on *what* a Work is and *why*: problem, background,
outcome, scope, non-goals, requirements, NFRs, acceptance criteria, constraints, assumptions,
risks, security/privacy, required evidence, source references, dependencies, authority
requirements, unresolved questions, and impact analysis (the directive's §9 field list). Each
edit produces a new immutable version; the sequence is append-only.

**Distinct from.** Not a Plan (the *how*) and not Work (the container). One Work has a sequence
of Specification versions; a Plan is written *against* a specific Specification version.

**Source of truth.** A `work_spec_versions` append-only table (target), each row an immutable
version pinned to a Work.

**Owner.** The work-specification/planning subsystem (E3).

**Lifecycle.** Per version: `draft → proposed → approved → superseded`. Versions are immutable;
"editing" appends a new version and supersedes the prior. A Work's `current_spec` points at the
latest approved version.

**Enforcement.** Acceptance criteria and required-evidence fields are machine-referenceable so
the change-impact gate can check them; a Plan may only bind to an `approved` Specification
version (no planning against a draft).

**Extension.** New requirement *categories* (e.g. an added NFR class) are optional fields on the
version schema; the version discipline itself is fixed and not extended.

**Tests.** Assert versions are immutable (an edit creates a new row, never mutates); assert a
Plan cannot bind a non-approved Spec version; assert `current_spec` always resolves to an
approved version once Work is `specified`.

**Migration.** No existing versioned-spec store — this is new. Seed from any existing PRD/brief
artifacts as the first `approved` version, preserving the source path as provenance.

**Deletion behavior.** Versions are never deleted (immutable audit trail); a whole Work's Specs
are archived with the Work.

**Graph representation.** Node type `work-spec version` (directive §4). Edges: Spec version
`supersedes` prior Spec version; Work `contains` Spec version; Plan `depends-on` Spec version.

**Schema (target).**
```
WorkSpecVersion {
  id, workspace   string
  work            id
  version         int          # monotonically increasing per Work
  problem, background, outcome  string
  scope, non_goals              string[]
  requirements, acceptance_criteria, nfrs  object[]
  constraints, assumptions, risks          object[]
  security_privacy              object
  required_evidence             object[]
  source_refs, dependencies     ref[]
  authority_requirements        object
  open_questions                string[]
  impact_analysis               id?      # link to a change-impact record
  state          enum(draft, proposed, approved, superseded)
}
```
**Example (illustrative).** Version 2 of the D1 Work, adding an acceptance criterion "all five
approval surfaces route through one chokepoint" after review.

## 7. Plan — *keep*

**Meaning.** The versioned *approach* to a Work Specification: decomposition, dependency graph,
assignments, worker/capability requirements, runtime selection, workspace/worktree strategy,
ownership boundaries, parallelization rationale, validation, integration, rollout, rollback,
cost, and expected graph changes (directive §9). One Specification version can have many Plan
versions (different approaches).

**Distinct from.** Not a Work Specification (the *what*) and not a Procedure (a *reusable*
template — a Plan is one-off, for one Work). A Plan *invokes* Procedures and *assigns* Worker
Profiles.

**Source of truth.** A `plan_versions` append-only table (target), each version pinned to a
Specification version.

**Owner.** The graph-informed planning subsystem (E3).

**Lifecycle.** Per version: `draft → approved → executing → (superseded | completed)`. A Run
pins exactly one Plan version.

**Enforcement.** Same-wave parallel Assignments in a Plan must have non-conflicting graph
neighborhoods, no shared authoritative schema mutation, and no shared file ownership (directive
§16). Bead/Assignment dependencies must derive from the graph, not narrative intuition
(directive §16) — a Plan whose declared dependencies contradict the graph is invalid.

**Extension.** New parallel topologies (single/sequential/parallel-research/parallel-mutation/
lead-worker/nested — directive §10) are Plan *shapes*, expressed by the assignment graph, not new
Plan subtypes.

**Tests.** Assert a Plan with overlapping file-ownership across concurrent Assignments is
rejected; assert Plan dependencies match graph edges; assert a Run pins one immutable Plan
version.

**Migration.** New store; no legacy planning artifact to migrate. The existing orchestration
routing tables (D4) inform runtime selection but are not the Plan itself.

**Deletion behavior.** Plan versions are immutable and archived with the Work; a superseded Plan
records why it was superseded (rollback rationale preserved).

**Graph representation.** Node type `plan version` (directive §4). Edges: Plan `depends-on` Spec
version; Plan `contains` Assignment; Plan `supersedes` prior Plan version; Plan `executed-by`
Run.

**Schema (target).**
```
PlanVersion {
  id, workspace     string
  work, spec_version  id
  version           int
  decomposition     Assignment[]        # the assignment graph
  runtime_selection object
  workspace_strategy enum(shared, worktree_per_assignment, container_per_assignment)
  parallelization   {justification, expected_benefit, added_cost, concurrency_limit,
                     ownership_boundaries, shared_state_restrictions, cancellation, timeout,
                     retry, synthesis, integration_sequence, completion_conditions}
  validation, rollout, rollback  object
  expected_graph_changes  object
  state             enum(draft, approved, executing, superseded, completed)
}
```
**Example (illustrative).** A Plan decomposing the D1 Work into "trace each of 5 approval
consumers" (parallel read-only) + one integration Assignment "route all through control-plane".

## 8. Run — *keep*

**Meaning.** One execution attempt of one Plan version: it records the exact Plan version,
Assignment states, runtime versions, model usage, checkpoints, approvals, Capability calls,
external effects, failures, Artifacts, resource usage, timestamps, and graph events (directive
§9). Re-attempting a failed Plan is a new Run.

**Distinct from.** Not a Plan (the intent) — a Run is the *record of executing* it. Not an
Assignment (a Run contains many). This concept already exists: `orchestration_runs`
(`lib/db/migrations/001_orchestration_runs.sql`), `lib/orchestration/run-store-sqlite.mjs`,
`run-store-postgres.mjs`, `run-store.mjs`.

**Source of truth.** The run store — table `orchestration_runs` (Postgres/team) or the SQLite
run store (`runs.db`, solo). Note the audit flags the SQLite schema as inline/unversioned (D5,
audit part B) — the migration below addresses it.

**Owner.** The orchestration runtime (`lib/orchestration/runtime.mjs`, `worker-runtime.mjs`).

**Lifecycle.** `pending → dispatched → running → (checkpoint…) → (completed | failed |
cancelled)`. Recovery resumes a Run without repeating accepted work (directive §11 E).

**Enforcement.** External effects must be idempotent and gated by Policy approval before
mutation (directive §11 E, §11 D); a Run cannot mark an Assignment complete without its declared
outputs. Checkpoints make interruption recoverable.

**Extension.** New runtimes are new adapters behind the runtime contract (directive E4); a Run's
schema does not change per runtime — runtime version is a recorded field.

**Tests.** Assert a Run resumes from a checkpoint without re-running accepted Assignments
(directive §11 E); assert every external effect has a prior approval record; assert re-attempt
creates a new Run pinning the same Plan version.

**Migration.** Give the inline SQLite run schema real migration files under `lib/db/migrations/`
(closing D5's "SQLite schema created inline, unversioned"); converge filesystem/sqlite/postgres
run backends on one migration story (D5).

**Deletion behavior.** Runs are retained as the execution audit trail; pruning is by
age/retention policy, never by hand, and never deletes a Run still referenced by accepted
completion evidence.

**Graph representation.** Node type — Run maps to the directive §4 node set via `assignment`/run
records; edges: Plan `executed-by` Run; Run `produces` Artifact; Run `evidenced_by`
runtime-evidence (the existing `runtime-evidence` node type + `evidenced_by` edge already seed
this — audit part A).

**Schema (target — extends existing `orchestration_runs`).**
```
Run {
  id, workspace     string
  plan_version      id
  assignment_states json     # per-Assignment status
  runtime_versions  json
  model_usage       json     # tokens, cost, tool calls
  checkpoints       json[]
  approvals         id[]      # Policy approval records
  capability_calls  id[]
  external_effects  id[]
  artifacts         id[]
  failures          json[]
  state             enum(pending, dispatched, running, completed, failed, cancelled)
  started_at, ended_at  ts
}
```
**Example (illustrative).** Run #1 of the D1 Plan completes 4 of 5 tracing Assignments, fails
on the MCP-coupled `destructive-approval` consumer, and is resumed as Run #2 from checkpoint.

## 9. Assignment — *keep*

**Meaning.** A typed unit of work within a Plan handed to exactly one worker: it names the
worker profile/capability required, the inputs, the expected outputs, the integration contract,
and its ownership boundary. Assignments are how a Plan is parallelized; workers communicate
*through* typed Assignments and immutable Artifact references, never free-form agent chatter
(directive §10).

**Distinct from.** Not a Run (the whole attempt) and not a Worker Profile (the *who*). An
Assignment is the edge from Plan to a worker with a contract. Partially exists as
`queue_items`+`claims` (`lib/db/migrations/002_queue_provider.sql`) and `workers`
(`003_worker_registry.sql`).

**Source of truth.** A `queue_items`/`assignments` table with `claims` (target consolidation of
`002`/`003`), scoped to a Run within a Plan.

**Owner.** The orchestration queue (`lib/queue/pg-queue.mjs`, `lib/embed/approval-queue.mjs` for
solo) + worker registry.

**Lifecycle.** `defined → claimable → claimed → running → (delivered | failed | cancelled) →
integrated`. `integrated` is set only by the Plan's single authoritative integration stage
(directive §10).

**Enforcement.** Concurrent mutating Assignments require separate worktrees/containers, explicit
ownership, scoped credentials, and independent tests before merge (directive §10, §16); an
Assignment's outputs must match its declared integration contract to be `delivered`.

**Extension.** New Assignment *roles* (reviewer, critic, synthesis, integration — directive §10)
are typed Assignment kinds, not new subsystems; the communication rules (typed messages, bounded
status events, structured handoffs) are fixed.

**Tests.** Assert two concurrent mutating Assignments have disjoint file ownership; assert an
Assignment cannot be `delivered` with outputs violating its contract; assert claim is exclusive
(no double-claim).

**Migration.** Consolidate `queue_items`/`claims`/`workers` under the Assignment concept keyed to
Plan/Run; retire the standalone routing-table duplication (D4) where it overlaps.

**Deletion behavior.** A cancelled Assignment releases its claim and cleans up its
worktree/container (directive §10 "cleanup, provenance"); the record persists for the Run audit.

**Graph representation.** Node type `assignment` (directive §4). Edges: Plan `contains`
Assignment; Assignment `owned-by` Worker Profile/worker; Assignment `produces` Artifact;
Assignment `blocks` Assignment (from the graph).

**Schema (target).**
```
Assignment {
  id, workspace     string
  plan_version, run id
  kind              enum(execute, review, critic, synthesis, integration)
  required_profile  id?      # Worker Profile
  required_capabilities id[]
  inputs            ref[]     # immutable Artifact refs
  outputs_contract  object    # integration contract
  ownership         {files: glob[], worktree: string?}
  claim             {worker: id, at: ts}?
  state             enum(defined, claimable, claimed, running, delivered, failed, cancelled, integrated)
}
```
**Example (illustrative).** `{ kind: execute, ownership: {files: ["lib/writes/**"],
worktree: "wt_d1_integration"}, outputs_contract: {…} }`.

## 10. Worker Profile — *merge*

**Meaning.** The configuration of a worker that can be assigned: its runtime, model capability
tier, skill emphasis, and the flows/procedures it is oriented toward. A Profile *selects* flows
and skill emphasis over a fixed role roster — it does not invent new roles or departments
(CLAUDE.md rule).

**Distinct from.** Not a Capability (a system operation) and not an Assignment (a unit of work).
This is the concept that *absorbs the organization metaphor*: personas, roles, teams, and
specialists collapse into "a Profile is a flow + skill emphasis" (intent verdict:
personas/roles/teams as fixed structure are discarded). It maps onto `lib/scopes/`,
`lib/project-profile.mjs`, `lib/skills-scope.mjs`, `specialists/org/scopes/` (creative,
operations, research, rnd), and `lib/models/execution-capability-profile.mjs`.

**Source of truth.** The scope/profile catalog in `specialists/org/scopes/` plus the
`execution-capability-profile` for runtime/model tiering — one Profile object, not a
persona+role+specialist trio.

**Owner.** The runtime/isolation-adapters subsystem (E4) selects the runtime; the profile
catalog owns the flow/skill emphasis.

**Lifecycle.** `draft → validated → promoted → deprecated` (the profile-lifecycle: discover →
frame → emphasize skills → validate → promote, per CLAUDE.md and
`docs/guides/concepts/profile-lifecycle.md`).

**Enforcement.** A Profile that lands in `specialists/org/scopes/` must pass the profile
lifecycle (CLAUDE.md protected-rule); it selects from the fixed 12-role roster and existing
flows/skills — it cannot invent roles. `construct scope create <id>` scaffolds the draft.

**Extension.** New Profiles are new *flow + skill-emphasis selections*, added through the
lifecycle; drop-in JSON is allowed for experiments but not the curated catalog (CLAUDE.md).

**Tests.** Assert a catalog Profile references only existing roles/flows/skills (no invented
roles); assert `construct scope create` produces a schema-valid draft + requirements brief;
assert profile → runtime resolution is deterministic.

**Migration.** Collapse the persona/role/specialist/team surfaces into Profiles: the graph's
current `specialist` node type migrates to `worker profile` nodes; personas (`personas/*.md`)
become skill-emphasis inputs, not separate first-class entities. This is a directive §9 explicit
decision ("whether roles/personas/specialists remain separate") — the target says they
consolidate.

**Deletion behavior.** A deprecated Profile is retired with an expiration; its historical
Assignments keep pointing at the retired Profile id (provenance preserved). Removing a Profile
cleans up its generated platform files via `construct sync` (program rule 2).

**Graph representation.** Node type `worker profile` (directive §4), replacing the current
`specialist` node type. Edges: Assignment `owned-by` Worker Profile; Worker Profile
`compatible-with` runtime; Worker Profile `requires` skill/capability.

**Schema (target).**
```
WorkerProfile {
  id, workspace?    string     # catalog profiles may be workspace-agnostic
  runtime           enum(claude, coding, process, acp, …)
  model_tier        enum(strong, standard, cheap)
  skill_emphasis    id[]        # skills, not roles
  flows             id[]        # Procedures oriented toward
  lifecycle_state   enum(draft, validated, promoted, deprecated)
}
```
**Example (illustrative).** `research.json`-style Profile: `{ runtime: claude, model_tier: strong,
skill_emphasis: [understand:research, plan:challenge], flows: [research-loop] }` — grounded in
the existing `specialists/org/scopes/research.json`.

## 11. Procedure — *merge*

**Meaning.** A reusable, named, versioned deterministic template of steps that many Plans can
invoke — the "workflow" concept, kept under a name that does not collide with the graph's
overloaded `graph`/`flow` surfaces. It encodes a repeatable sequence with defined handoffs and
required integrations.

**Distinct from.** Not a Plan (one-off, for one Work) — a Procedure is reused across Works. This
is the concept that *splits the two flow systems* (reconciliation 1): the **live** declarative
workflow-manifest system (`lib/workflows/` + `lib/embedded-contract/workflow-defs.mjs`, 15 types,
drift-tested) **is** the Procedure; the **dead** state-machine engine (`lib/flows/` +
`lib/orchestration/delegation-flow.mjs`, X1, repo audit `02-deadcode:module-test-only`) **is
not** and is a deletion target (directive's "flow-engine deletion" points at `lib/flows/`).

**Source of truth.** The workflow definitions (`workflow-defs.mjs`) validated by the manifest
schema (`lib/workflows/manifest-schema.mjs`, `validate.mjs`).

**Owner.** The workflow/procedure subsystem (`lib/workflows/`: loader, validate, instantiate,
liveness, surface-parity).

**Lifecycle.** `defined → active → deprecated → removed`. Liveness is already tracked
(`lib/workflows/liveness.mjs`) and drift-tested.

**Enforcement.** Procedure→provider→tool requires-integrity is already validated by the graph
(`lib/graph/validate.mjs`: "workflow→provider→tool requires-integrity", handoff-cycle check,
surface parity — audit part A). A Procedure with a dangling required tool is invalid.

**Extension.** New Procedures are new manifest entries behind the manifest schema — drop-in
declarative definitions, not code; this is the existing extension path and it is kept.

**Tests.** Assert every Procedure's required providers/tools exist (requires-integrity); assert
no handoff cycle; assert surface parity across platforms (existing `tests/graph/` + workflow
tests). Assert `lib/flows/` has zero live importers before deletion (X1 gate).

**Migration.** Rename the *concept* workflow→Procedure in docs/graph node type (`workflow` node
→ `procedure` node) while keeping the live `lib/workflows/` implementation; delete `lib/flows/`
+ `delegation-flow.mjs` with a deletion bead and criteria (program rule 2). The rename is a
migration cost flagged here, not an assumption.

**Deletion behavior.** A removed Procedure is deleted only after the graph confirms no active
Plan/Directive references it; the dead `lib/flows/` engine gets its own deletion bead with a
zero-importer criterion.

**Graph representation.** Node type `procedure` (directive §4), replacing the current `workflow`
node type. Edges: Plan `uses`/`requires` Procedure; Procedure `requires` provider/tool;
Directive `uses` Procedure.

**Schema (target — the existing manifest shape).**
```
Procedure {
  id, workspace?    string
  name              string
  steps             {step, handoff, required_capability}[]
  required_providers, required_tools  id[]
  version           int
  state             enum(defined, active, deprecated, removed)
}
```
**Example (illustrative).** A grounded Procedure is any of the 15 live workflow types in
`lib/embedded-contract/workflow-defs.mjs` (e.g. a research or review workflow) — kept as-is,
renamed at the concept layer.

## 12. Capability — *keep*

**Meaning.** A typed operation the *system* can perform, defined by a contract (preconditions,
postconditions, inputs, outputs). Capabilities are what Assignments require and Procedures/Plans
compose. They already exist and are populated: `registry/capabilities.json`,
`platforms/capabilities.json`, and the handoff contracts in `specialists/org/contracts/`
(`any-to-*.json`, `architect-to-*.json`); the graph has 37 `capability` nodes (audit part A).

**Distinct from.** Not a Worker Profile (the *who*) and not a Procedure (a *sequence*) — a
Capability is a single typed operation with a contract. Not a Tool (a Capability may be realized
by one or more tools/providers).

**Source of truth.** `registry/capabilities.json` + the contract files in
`specialists/org/contracts/`.

**Owner.** The capability registry; contracts are enforced by
`specialists/org/contracts/` postconditions (CLAUDE.md: enforced on specialist handoffs).

**Lifecycle.** `declared → active → deprecated → removed`. A deprecated Capability that
disappears while referenced fails the change-impact gate (directive §4).

**Enforcement.** Contract postconditions are enforced on handoffs (CLAUDE.md); the graph's
`realizes`/`requires` edges tie Capabilities to the modules and tests that implement and cover
them (`lib/graph/validate.mjs` "capability test coverage" — audit part A). A change that removes
a referenced Capability cannot be complete (directive §4 gate).

**Extension.** New Capabilities are new registry entries + a contract; realization is a new
`realizes` edge from an implementing module — the extension path already exists.

**Tests.** Assert every active Capability has ≥1 covering test (the existing graph
`missing-tests`/coverage query); assert contract postconditions hold on handoff; assert a removed
Capability with inbound `requires` edges is blocked (gate).

**Migration.** No migration — Capability already exists in the target shape. Consolidate the two
`capabilities.json` files (`registry/` vs `platforms/`) if they diverge (checked in b0nny.4
disposition, not here).

**Deletion behavior.** Removing a Capability requires zero inbound `requires`/`realizes` edges
(the gate); its contract file is deleted with it and its allowlist entries cleaned (program rule
2, mirroring the X3 codemod-deletion pattern).

**Graph representation.** Node type `capability` (directive §4 — already exists). Edges: module
`realizes` Capability; test `covers`/`validates` Capability; Assignment `requires` Capability;
Procedure `uses` Capability.

**Schema (target — the existing registry shape).**
```
Capability {
  id, workspace?    string
  name              string
  contract          {pre: object, post: object, inputs: schema, outputs: schema}
  realized_by       module_id[]
  state             enum(declared, active, deprecated, removed)
}
```
**Example (grounded).** Any entry in `registry/capabilities.json` with its handoff contract in
`specialists/org/contracts/` (e.g. `any-to-researcher.json`).

## 13. Policy — *merge*

**Meaning.** The rules that govern whether an effect is allowed and what approval it requires:
authority boundaries, approval requirements, revalidation, leases, and idempotency at the
mutation boundary. Policy is the *single governed-write chokepoint* — the directive's "strong
authority/approval boundaries".

**Distinct from.** Not a Directive (which *generates* work) — Policy *gates* effects. This is
the concept that *collapses the five duplicate approval/authority surfaces* (D1:
`embed/approval-queue`, `writes/write-intent`, `mcp/destructive-approval`,
`roles/approval-surface`, `cli/approvals`). Wave 0 (A4) proposes convergence on
`lib/writes/control-plane.mjs` (already has 8 importers incl. all provider governed-writes), but
`roles/approval-surface` and `destructive-approval` have MCP-side couplings — so the single
chokepoint is **unverified** until the WS6 evidence pass traces every consumer (**A4**).

**Source of truth.** The write-policy + control-plane at `lib/writes/`
(`control-plane.mjs`, `write-policy.mjs`, `write-intent.mjs`, `envelope.mjs`, `sent-log.mjs`),
targeted as the single chokepoint pending A4.

**Owner.** The policies/approvals/effects subsystem (E6): authority, policy, approval,
revalidation, leases, idempotency, transactional outbox, external verification.

**Lifecycle.** Per Policy: `draft → active → superseded`. Per approval instance:
`requested → (granted | denied) → (consumed | expired)`; a stale approval is revalidated, not
silently reused (directive §11 E).

**Enforcement.** No external mutation without a prior granted, non-expired approval (directive
§11 D "approval before external mutation"); the chokepoint is the *only* path to a governed
write. The repo's `no-skip-vars` stance (CLAUDE.md) forbids `CONSTRUCT_ALLOW_*` escape hatches
around it.

**Extension.** New effect classes are new Policy rules behind the chokepoint contract, not new
approval surfaces — the whole point of the merge is that no sixth surface is added.

**Tests.** Assert every external effect traces to one granted approval; assert an expired
approval forces revalidation (directive §11 E); assert all five legacy surfaces route through
the one chokepoint (the A4 verification, WS6).

**Migration.** Route `embed/approval-queue`, `mcp/destructive-approval`,
`roles/approval-surface`, and `cli/approvals` through `writes/control-plane`, then delete the
redundant surfaces with deletion beads (D1 resolution; A4-gated). Idempotency + transactional
outbox migrate from any per-surface handling to the chokepoint.

**Deletion behavior.** A superseded Policy is retired with an expiration; removing a redundant
approval surface requires proving zero effect bypasses the chokepoint first (A4 evidence).

**Graph representation.** Node type `policy` (directive §4). Edges: Policy `governs`/`authorizes`
effect; Work/Directive `governed_by` Policy; the existing `governed_by`/`secures` edges seed
this (audit part A).

**Schema (target).**
```
Policy {
  id, workspace     string
  scope             {effect_class: enum(git_write, tracker_write, external_api, delete, …)}
  requires_approval bool
  authority         object     # who may grant
  lease, revalidation, idempotency  object
  state             enum(draft, active, superseded)
}
Approval {
  id, policy, effect_ref  string
  state             enum(requested, granted, denied, consumed, expired)
  granted_by, at    string, ts
}
```
**Example (illustrative).** A Policy `{ effect_class: git_write, requires_approval: true }` whose
approval is requested before the D1 integration Assignment pushes to any external tracker.

## 14. Artifact — *keep*

**Meaning.** A content-identified output produced by a Run/Assignment: a document, code diff,
report, or dataset, with content identity, producer, inputs, verification, acceptance evidence,
provenance, freshness, supersession, and security classification (directive §9).

**Distinct from.** Not Evidence (the *assertion about* an Artifact — concept 15) and not a Run
(the *producer*). "File export is not artifact completion" (CLAUDE.md): an Artifact advances the
completion ladder only with re-verifiable evidence, which is exactly why Evidence is a separate
relationship.

**Source of truth.** An `artifacts` record per Workspace with a content hash (target); artifact
*storage* backend is a directive §7 decision left to b0nny.4, but the identity record is domain.

**Owner.** The run/worker subsystem produces them; the completion-state machine
(`docs/guides/reference/artifact-completion-states.md`) governs their status.

**Lifecycle.** `draft → exported → verified → accepted → superseded` (the completion ladder,
CLAUDE.md). `exported ≠ accepted` — the load-bearing distinction.

**Enforcement.** An Artifact reaches `accepted` only with re-verifiable Evidence (CLAUDE.md,
`construct publish --preview`); content identity (hash) must be stable and provenance complete
(no fabrication — CLAUDE.md).

**Extension.** New Artifact *types* (directive §4 "artifact type" node) are new type tags with a
verification method, not new stores; classification levels extend as an enum.

**Tests.** Assert `accepted` is blocked without acceptance Evidence; assert content hash pins
identity across supersession; assert provenance (producer Run + inputs) is complete.

**Migration.** Existing produced files (docs, reports under `.construct/`) get Artifact records
retroactively where they are load-bearing; freshness/supersession backfilled from git history
where available.

**Deletion behavior.** A superseded Artifact records a `supersedes` edge to its replacement and
is retained (provenance); hard-delete only on Workspace purge, never for an Artifact that is a
Work's acceptance evidence.

**Graph representation.** Node type `artifact type` (directive §4). Edges: Run/Assignment
`produces` Artifact; Artifact `supersedes` Artifact; Artifact `evidenced_by`/`verifies` (see
Evidence); Artifact `sourced-from` inputs.

**Schema (target).**
```
Artifact {
  id, workspace     string
  type              enum(document, code_diff, report, dataset, …)
  content_hash      string        # content identity
  producer_run      id
  inputs            ref[]
  verification      {method, result}
  classification    enum(public, internal, restricted)
  freshness         ts
  state             enum(draft, exported, verified, accepted, superseded)
  supersedes        id?
}
```
**Example (grounded).** *This document* is an Artifact: `{ type: document,
content_hash: <sha of target-model.md>, producer_run: "b0nny.1", state: exported }` — and it
reaches `accepted` only with re-verifiable Evidence, per CLAUDE.md.

## 15. Evidence — *replace*

**Meaning.** The *relationship* asserting that an Artifact (or Run result) verifies or satisfies
a requirement, acceptance criterion, or Objective. The directive §8 calls it "Evidence
**relationship**" — it is an edge, not a standalone record.

**Distinct from.** Not an Artifact (the content) — Evidence is the *assertion connecting* an
Artifact to what it proves. The **replace** verdict: rather than a new standalone Evidence store,
it is realized as a graph edge type, reconciling directly with the existing `evidenced_by` edge
in `lib/graph/store.mjs` (audit part A). Whether an edge's attributes suffice (vs a heavier
first-class record for verification method/freshness/classification) is logged as **A8**.

**Source of truth.** A typed edge (`evidenced_by` / `verifies`) in the graph store, carrying the
assertion's provenance and confidence — the graph edge's `sources[]`/`weight` already model
this (audit part A). If A8 resolves that attributes are too heavy for an edge, a thin
`evidence` record with an edge pointer is the fallback.

**Owner.** The graph subsystem owns the edge; the completion-state machine consumes it to gate
Artifact/Objective acceptance.

**Lifecycle.** Per the edge's assertion: `asserted → verified → (stale | refuted)`. Freshness
matters — an Evidence edge can go stale when its Artifact is superseded.

**Enforcement.** Acceptance transitions (Artifact→`accepted`, Objective→`met`, Work→`accepted`)
require ≥1 non-stale Evidence edge (CLAUDE.md re-verifiable evidence; directive §4 completion
gate). Model-generated Evidence never becomes authoritative without a re-verifiable source
(directive §4, program rule 4).

**Extension.** New verification *methods* are attributes on the edge (or the A8 record), not new
edge types; the edge type set stays bounded (directive §4 "no generic related-to collapse").

**Tests.** Assert acceptance is blocked without a non-stale Evidence edge; assert an Evidence
edge goes stale when its Artifact is superseded; assert inferred Evidence is distinguishable
from declared (directive §4 inferred-vs-declared).

**Migration.** Reuse the existing `evidenced_by` edges as the seed Evidence set; add the
`verifies` direction (Artifact→criterion) where only `evidenced_by` (record→evidence) exists
today.

**Deletion behavior.** Removing an Artifact removes its outbound Evidence edges and marks any
acceptance it supported as needing re-verification (no silent acceptance survival).

**Graph representation.** This concept *is* a graph edge: `evidenced_by` / `verifies` (directive
§4 edge set includes `verifies`, `evidenced_by`). Endpoints: Artifact→(requirement / acceptance
criterion / Objective).

**Schema (target — an edge, extending the existing edge shape).**
```
EvidenceEdge {
  rel               enum(evidenced_by, verifies)
  from              artifact_id | run_id
  to                criterion_id | objective_id | requirement_id
  method            enum(test, preview, external_check, review)
  confidence        float
  sources           enum[]      # declared vs inferred (existing edge sources[])
  state             enum(asserted, verified, stale, refuted)
}
```
**Example (illustrative).** `{ rel: verifies, from: "artifact:target-model.md",
to: "criterion:all-18-concepts-covered", method: review, state: asserted }` — the Evidence that
would gate *this* Work's acceptance.

## 16. Projection — *replace*

**Meaning.** The representation of domain objects (chiefly Work) in an external tracker — Beads,
Jira, GitHub, Linear — with explicit field authority and reconciliation. A Projection is
*downstream* of the domain model; the tracker item is a mirror, not the source of truth.

**Distinct from.** Not the Work itself. The **replace** verdict is the directive's load-bearing
reframing (§9): "If Beads remains it is a projection adapter, not the domain model." Today Beads
(`lib/beads-client.mjs`, `.beads/`) is effectively treated as the tracker of record; the target
demotes it to one Projection adapter. Viability as a projection is **A5** (Dolt sync healthy but
5.4MB jsonl + daemon contention observed).

**Distinct from Source.** A Source is *inbound* (signals in); a Projection is *outbound*
(domain state mirrored out). Beads is unusual in being both a Source and a Projection target —
the two roles stay separate concepts even when one system fills both.

**Source of truth.** The *domain* record (Work, concept 5) is authoritative; the Projection
holds only projected fields plus a field-authority map declaring which side owns each field.

**Owner.** The tracker-projections/migration subsystem (E8): Beads projection, field authority,
reconciliation, importers, raw-record preservation.

**Lifecycle.** Per projected item: `projected → reconciling → in_sync → drifted`. Drift triggers
reconciliation, not silent overwrite.

**Enforcement.** Field authority is explicit: a field owned by the domain is never overwritten by
the tracker and vice versa; reconciliation is bidirectional with conflict detection (directive
§9). Raw tracker records are preserved (directive §14.16).

**Extension.** New trackers are new Projection adapters behind a stable projection contract
(directive caps first-party integration adapters at ≤2, §13); a new adapter does not change the
domain model.

**Tests.** Assert a domain-owned field survives a conflicting tracker edit (field authority);
assert reconciliation detects and reports drift rather than clobbering; assert raw records are
preserved on import (directive §14.16); assert the domain model is readable with the tracker
absent (tracker independence, directive §19).

**Migration.** Existing Beads issues import as Projections *of* freshly-authored Work domain
records (the E8 "importers" + "raw-record preservation"); the Beads hygiene contract
(`rules/common/beads-hygiene.md`) continues to apply to the projection.

**Deletion behavior.** Removing a Projection adapter stops mirroring; domain Work is unaffected
(tracker independence). A deleted tracker item does not delete the domain Work — it marks the
Projection `drifted`.

**Graph representation.** Node type `bead/tracker item` (directive §4). Edge: Work `projects-to`
Projection (directive §4 `projects-to` edge). The domain Work node is authoritative; the
Projection node is explicitly a mirror.

**Schema (target).**
```
Projection {
  id, workspace     string
  work              id            # the domain object projected
  tracker           enum(beads, jira, github, linear)
  external_id       string
  field_authority   {field: enum(domain, tracker)}
  state             enum(projected, reconciling, in_sync, drifted)
  raw_record        json          # preserved source-of-import
}
```
**Example (grounded).** This bead `construct-b0nny.1` is a Beads Projection: the domain Work is
"draft the target conceptual model"; the Beads issue mirrors title/status/acceptance while the
domain record owns the Spec/Plan/Run detail.

## 17. Graph node — *keep*

**Meaning.** A typed, uniform *representation* of a domain object (or code/doc/infra element) in
the capability/dependency graph, carrying stable id, type, version, workspace scope, source of
truth, provenance, evidence location, confidence, first-observed/last-verified, lifecycle state,
owning subsystem, rebuild strategy, and conflict status (directive §4). The target ontology is
~35 node types (directive §4); today there are 16 (`lib/graph/store.mjs`).

**Distinct from — the key non-duplication rule.** A Graph node is **not** a synonym for the
domain object it represents. The domain store (Work, Capability, Policy, …) is the source of
truth; the Graph node is an *index/projection* of it with graph metadata. Collapsing the two
would recreate the dual-source-of-truth failure D6 warns about, and would violate directive §4
("model-generated claims never become authoritative without evidence"). Every node's schema
includes an explicit `source_of_truth` pointer *back* to the owning store.

**Source of truth.** The graph store (target: relational SQLite/Postgres tables, directive §4;
today `nodes.jsonl` in `.construct/graph/` — audit part A). Each node's *values* trace to the
domain store named in its `source_of_truth` field; the graph is authoritative only for graph
metadata (edges, confidence, lifecycle observation).

**Owner.** The dynamic graph subsystem (E1, first production epic — the port-and-extend of
`lib/graph/`, reconciliation 2).

**Lifecycle.** `active → deprecated → superseded → deleted → unknown` (directive §4 exact node
lifecycle states). `unknown` is a first-class state for nodes whose truth cannot currently be
confirmed.

**Enforcement.** Inferred nodes are distinguishable from declared (directive §4); a node cannot
be authoritative without evidence; the change-impact gate consumes node lifecycle to block
completion when a referenced node disappeared (directive §4). Cross-platform equivalence:
SQLite and Postgres must return the same results (directive §4 day-one milestone).

**Extension.** New node types extend toward the ~35-type ontology (directive §4) — but the full
ontology is owned by **b0nny.2** (graph-foundation design), not this document. This concept model
supplies the *domain* node types (workspace, source, objective, directive, work, work-spec
version, plan version, assignment, worker profile, procedure, capability, policy, artifact type,
bead/tracker item) and defers the code/infra node types to b0nny.2. No generic node type is
allowed (mirrors the "no `related-to`" edge rule).

**Tests.** Assert every node carries the full metadata set (id, type, version, scope,
source_of_truth, provenance, confidence, timestamps, lifecycle, owner, rebuild strategy, conflict
status); assert inferred vs declared is queryable; assert SQLite/Postgres parity; assert a node's
values match its `source_of_truth` store (no graph-authoritative drift).

**Migration.** Port the 16 existing node types onto the relational store and extend to ~35 (A2:
"existing graph semantics extend cleanly to the directive's ~35-type ontology" — the mapping in
this document *is* A2's test artifact). Add the absent `workspace` scope field to every node
(workspace scoping absent today — A2 opposing evidence). Rename `workflow`→`procedure`,
`specialist`→`worker profile` node types (concepts 10, 11).

**Deletion behavior.** A deleted domain object sets its node lifecycle to `deleted` (tombstone),
which the impact gate reads to block changes that leave active inbound edges (directive §4
deletion eligibility); the node is not physically removed until reconciliation confirms no
inbound dependency.

**Graph representation.** This concept *is* the node — it is the graph's own element type.
Realized as a `nodes` table (target) / `nodes.jsonl` (today).

**Schema (target — extends `lib/graph/store.mjs`).**
```
GraphNode {
  id                string        # type:key (existing convention)
  type              enum(~35 types)
  version           int
  workspace         string        # NEW scope field (absent today, A2)
  source_of_truth   {store, ref}  # pointer BACK to the domain store — non-authoritative graph
  provenance        {sources: enum[], first_observed: ts, last_verified: ts}
  confidence        float
  lifecycle         enum(active, deprecated, superseded, deleted, unknown)
  owner             string        # owning subsystem
  rebuild_strategy  string
  conflict_status   enum(none, contested)
}
```
**Example (grounded).** `{ id: "capability:any-to-researcher", type: capability,
source_of_truth: {store: "registry/capabilities.json"}, provenance: {sources: [registry]},
lifecycle: active }` — a real node in the live 3,250-node graph, extended with a workspace scope
and explicit source-of-truth pointer.

## 18. Graph edge — *keep*

**Meaning.** A typed, directed relationship between two Graph nodes, carrying its own provenance
(`sources[]`), weight, confidence, and inferred-vs-declared distinction (directive §4). The
target ontology is ~30 typed edges (directive §4); today there are 16 relations
(`lib/graph/store.mjs`), with **no generic `related-to` collapse** allowed.

**Distinct from.** Not a Graph node (endpoints) and not the domain relationships themselves — an
edge is the graph's *typed record* of a relationship, which may be *declared* (from a manifest)
or *discovered/inferred* (from an import scan, co-change, or runtime evidence). The Evidence
concept (15) is realized as a specific edge type here — Evidence is a *subset* of Graph edge, not
a separate store.

**Source of truth.** The graph store's edge table (target relational; today `edges.jsonl` sorted
by `from|rel|to` — audit part A). Declared edges' truth traces to the declaring manifest;
inferred edges carry lower confidence and are never authoritative alone (directive §4).

**Owner.** The dynamic graph subsystem (E1).

**Lifecycle.** An edge is active while both endpoints are active and its source still asserts it;
it goes `stale` when its source hash moves (the existing per-source `staleness.mjs` — audit part
A) and is removed or re-derived on reconciliation.

**Enforcement.** Inferred edges must be distinguishable from declared (directive §4
`sources[]`); no generic `related-to` type (directive §4); the impact gate reads edges to
compute directly-changed + transitive dependents (directive §4). The full edge-type set must map
to the directive's ~30 named edges without a catch-all.

**Extension.** New edge types extend toward the ~30-edge ontology — **owned by b0nny.2**. This
concept model supplies the *domain-level* edges (realizes, contains, depends-on, produces,
governs, authorizes, projects-to, executed-by, sourced-from, supersedes, verifies, owned-by) and
defers code/infra edges to b0nny.2. The bounded, named set is a hard constraint, not a
suggestion.

**Tests.** Assert no edge has a generic/`related-to` type; assert inferred vs declared is
queryable; assert edge de-dup sums weight (existing behavior — audit part A); assert
reconciliation removes edges whose source no longer asserts them; assert recursive traversal
(target CTE) matches the current JS BFS/DFS results (A1 port-equivalence).

**Migration.** Port 16 relations onto the relational store, extend to ~30, add recursive-CTE
traversal to replace JS adjacency (A1 gates whether relational meets the workload). The
`weight`/`sources[]`/de-dup semantics port with minimal change (audit "impact-analysis logic is
portable onto a SQL store with minimal semantic change").

**Deletion behavior.** Deleting a node cascades to mark its edges for reconciliation; a deletion
that would leave active inbound edges is blocked by the impact gate (directive §4 "a deletion
leaves active inbound dependencies"). Superseded relationships get a `supersedes` edge rather
than silent removal.

**Graph representation.** This concept *is* the edge — realized as an `edges` table (target) /
`edges.jsonl` (today).

**Schema (target — extends `lib/graph/store.mjs`).**
```
GraphEdge {
  from, to          node_id
  rel               enum(~30 named types)   # no generic related-to
  weight            number                   # summed on de-dup (existing)
  sources           enum[]                   # declared vs discovered vs runtime (existing)
  confidence        float
  inferred          bool                     # distinguishable from declared
  state             enum(active, stale, superseded)
}
```
**Example (grounded).** `{ from: "test:tests/graph/impact.test.mjs", to: "capability:graph-impact",
rel: covers, sources: [import-graph], inferred: true }` — a real inferred edge in the live
8,522-edge graph.

---

# Contradictions with Wave 0 evidence — resolved or logged

Wave 0's assumption register (A1–A5) is *carried and honored* by this model, not contradicted:

- **A1** (relational traversal meets the workload) gates the Graph node/edge migration; this
  model states the target relational shape but defers the load test to Validation Spike A
  (b0nny.5). No contradiction.
- **A2** (existing 16×16 semantics extend to ~35 types) — this document *is* A2's named test
  ("WS5 target-model draft mapped onto existing data before E1 build"). The mapping succeeds with
  two renames (`workflow`→`procedure`, `specialist`→`worker profile`) and one added scope field
  (`workspace`). The opposing evidence (workspace scoping absent) is resolved by the Workspace
  concept. **A2 supported, not refuted.**
- **A3** (pre-change-intent packet lands before graph-foundation) is a *sequencing* dependency
  for b0nny.2/3, untouched here. No contradiction.
- **A4** (five approval surfaces converge on one chokepoint) is honored as an *open* gate on the
  Policy concept — the single-chokepoint claim is explicitly marked `unverified` pending the WS6
  evidence pass. No contradiction; the risk is surfaced, not hidden.
- **A5** (Beads viable as a projection adapter) is honored as an open gate on the Projection
  concept. No contradiction.

Three **new** load-bearing assumptions were introduced by this Wave 1 factoring and must be
tested downstream:

| ID | Assumption | Supporting | Opposing | If wrong | Test |
|---|---|---|---|---|---|
| A6 | Work and Objective are distinct nodes (1 Work → 1 Objective; 1 Objective → N Work over time) | Directive §4 lists both as node types; an Objective can outlive the Work that advances it | Directive §9 omits an explicit "Work" umbrella, listing only Objective/Spec/Plan/Run — Objective could *be* Work's top field | Collapse Objective into a field of Work; drop the `realizes` Work→Objective edge | b0nny.3 planning epic exercises one Objective spawning ≥2 Works; if that never occurs in the corpus, merge |
| A7 | Standing Directive warrants a store distinct from both Source and Policy | `lib/directives/` + `oracle/directive-executor.mjs` already exist as a distinct subsystem | A Directive could be a Policy that emits Objectives, or a Source of internal signals | Fold Directive into Policy (a rule that generates Work) or Source | The daily-workplace-loop spike (directive §11 D / b0nny.5) shows whether directive-generated work needs its own lifecycle |
| A8 | Evidence is adequately a graph edge (not a standalone record) | The graph already has `evidenced_by` with `sources[]`/`confidence`; Artifact carries content, the edge carries the assertion | Acceptance evidence may need heavier attributes (verification method, freshness, classification) than an edge cleanly holds | Promote Evidence to a thin record with an edge pointer | b0nny.2 graph-foundation schema decides whether edge attributes suffice |

# Relationship map (concept graph, condensed)

```
Source ──sourced-from──▶ Objective ◀──realizes── Work ──contains──▶ Work (child)
Directive ──emits──▶ Objective/Work                     │
                                                        ├─ current_spec ─▶ Work Specification (versioned)
                                                        ├─ current_plan ─▶ Plan (versioned) ──contains──▶ Assignment
Plan ──executed-by──▶ Run ──produces──▶ Artifact ──verifies/evidenced_by──▶ (criterion | Objective)   [= Evidence]
Assignment ──owned-by──▶ Worker Profile ;  Assignment ──requires──▶ Capability ;  Plan ──uses──▶ Procedure
Work ──governed_by──▶ Policy ◀──governs── external effect (approval-gated)
Work ──projects-to──▶ Projection (Beads/Jira/…)   [tracker mirror, non-authoritative]
every domain object ──represented-by──▶ Graph node ; every domain relationship ──represented-by──▶ Graph edge
      (graph = index/projection; source_of_truth points BACK to the domain store)
```

# What this document deliberately does not do

- It does **not** enumerate the full ~35-node / ~30-edge ontology — that is `construct-b0nny.2`
  (graph-foundation design). It supplies the *domain* node/edge types and defers code/infra types.
- It does **not** choose artifact storage, database technology, or runtime adapters — those are
  directive §7 decisions owned by `construct-b0nny.4` (disposition matrix) and the E-epic set.
- It does **not** design state machines beyond the per-concept lifecycles above; full state-chart
  diagrams are a directive §14.9 output that the graph-foundation and work-spec epics render.
- No validation spike is run here (directive §11) — spikes are `construct-b0nny.5`.
