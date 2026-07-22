---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Source Directive — Condensed Requirements

Condensed by the program lead from the 38-page source directive (provenance in
[baseline.md](baseline.md)). This is a faithful requirement extraction, not a decision
document; decisions land in `synthesis/`. Section numbers reference the source.

## Mandate (§Role, §1)

- Determine what Construct must become; validate load-bearing decisions through research and
  executable experiments; produce a complete implementation bead program another capable model
  can execute in parallel.
- Explicit authorization to remove, replace, or rebuild most of the current system. The
  existing repository is evidence of intent and learning — not the boundary of the target.
- Operating context: open-source side project, one maintainer who uses Construct daily but may
  not touch the core for weeks. Optimize for useful outcomes, low maintenance, understandable
  failure modes, safe recovery, local-first, replaceable runtimes, strong authority/approval
  boundaries, complete evidence and provenance, aggressive deletion of superseded systems.
  Do **not** optimize for novelty, feature count, popularity, or organization metaphors.

## Target hypothesis to pressure-test (§3)

> Construct should become a workspace-level work and governance control plane over replaceable
> human and AI execution runtimes.

Construct owns: Workspaces, Sources, Objectives, Standing Directives, versioned Work
Specifications and Plans, Runs and Assignments, capability contracts, Worker Profiles,
Policies, Authority, Approvals, effect execution records, Artifacts, Evidence, Provenance,
Reconciliation, Tracker projections, the capability/dependency graph, Outcome evaluation.

Construct delegates: inner agent loops, model invocation/routing, worker-session context
compaction, terminal/browser execution, coding-agent behavior, container/worktree mechanics,
remote sandboxes, document-conversion and vector-store implementations, cloud deployment
infrastructure, editor communication, external tracker internals.

If evidence disproves part of the hypothesis, provide the superior concrete decision — the
final architecture may not remain undecided.

## Non-negotiable: dynamic capability & dependency graph (§4)

- The graph is a first-class operational subsystem from day one — not a diagram, static doc,
  one-time inventory, or late observability feature. Every material change is checked against
  it before being execution-ready or complete.
- Two stages: a disposable but executable **bootstrap graph** (reconstruct the existing
  system, find duplication/hidden deps/orphans/false workstream independence, design the
  target, generate the bead program, assign safe parallel ownership) and the **production
  graph** (first foundational implementation epic; all other epics depend on it).
- Audit the current graph implementation before trusting it; reuse only where evidence shows
  it accurately represents the repo and its runtime dependencies.
- Minimum ontology: ~35 node types (workspace, objective, directive, work, work-spec version,
  plan version, assignment, worker profile, procedure, capability, policy, source, four
  adapter kinds, package, module, public interface, schema, durable record type, CLI command,
  API route, event type, configuration field, artifact type, evidence requirement, test,
  evaluation, security control, deployment component, migration, ADR, documentation surface,
  bead/tracker item) and ~30 typed edges (contains, implements, exposes, consumes, produces,
  depends-on, calls, reads, writes, validates, verifies, governs, authorizes, projects-to,
  executed-by, compatible-with, supersedes, migrates, deprecates, deletes, blocks,
  conflicts-with, affected-by, owned-by, documented-by, tested-by, evaluated-by, deployed-by,
  sourced-from). No generic `related-to` collapse.
- Every node/edge: stable id, type, version, workspace scope, source of truth, provenance,
  evidence location, confidence, first-observed/last-verified, lifecycle state (active,
  deprecated, superseded, deleted, unknown), owning subsystem, rebuild strategy, conflict
  status. Inferred edges distinguishable from declared; model-generated claims never become
  authoritative without evidence.
- Storage: SQLite (embedded) / Postgres (shared), relational node + typed-edge tables,
  recursive SQL traversal, transactional updates, transactional outbox for graph-affecting
  events, optional materialized projections. No graph database unless a spike proves
  relational cannot meet the workload.
- Sources: declared (manifests, contracts, profiles, policies, schemas, migrations, work
  specs, plans, beads, ADRs) + discovered (imports, exports, calls, config reads, schema
  refs, table access, CLI handlers, API routes, events, test-to-code, workflows, deployment
  manifests, doc references, git history) + runtime-observed (capability invocations, adapter
  execution, artifact production, external effects, run traces, evaluation results, failure
  records). Each retains origin and confidence.
- Incremental update on relevant changes; full rebuild remains available for reconciliation
  but normal operation must not require it.
- Command surface (names flexible, capabilities mandatory): build, update, validate, query,
  impact, path, owners, requirements, orphans, cycles, drift, explain, export.
- Change-impact gate: before acceptance compute directly-changed nodes, first-order and
  bounded transitive dependents, affected capabilities/contracts/schemas, required
  migrations/tests/evaluations/reviewers, documentation/security/deployment/tracker impact,
  deletion eligibility, confidence and unresolved gaps. Impact result becomes part of Work,
  Plan, Run, and completion evidence. A change cannot be complete while required dependents
  are unevaluated, required tests unrun, a referenced capability disappeared, a schema changed
  without migration disposition, an adapter became incompatible, a deletion leaves active
  inbound dependencies, or high-confidence contradictions stand.
- Every implementation bead declares graph nodes it creates/changes/deprecates/deletes,
  expected edge changes, impacted dependents, required validation, ownership and parallel
  conflict boundaries. Bead dependencies derive from the graph, not narrative intuition.
- Day-one milestone: register nodes → derive edges → incremental update → query
  up/downstream → detect deliberate cycle → detect orphaned capability → impact report for a
  changed schema → identify affected tests/adapters → block a simulated change omitting
  required validation → export JSON + human-readable diagram → equivalent results on SQLite
  and Postgres → rebuild and reconcile against incremental state.

## Required investigation & research (§5, §6)

- Full repository investigation (source, docs, git history, branches, PRs, schemas, CLI,
  APIs, daemons, flow engine, orchestration runtime, provider loops, MCP/ACP, specialists,
  personas, roles, teams, profiles, packs, skills, workflows, task packets, beads, memory,
  source ingestion/monitoring, directives, oracle, governed writes, approvals, telemetry,
  evaluations, artifacts, deployment modes, state stores, tests, CI, packaging). Compare
  documented vs implemented vs active vs dead. Do not infer intent from the README alone.
- Primary-source external research: OpenAI Agents SDK (TS/Python), Claude Agent SDK, Claude
  Managed Agents, Claude Code subagents/teams/background agents/worktrees, OpenHands SDK,
  ACP, MCP (+ MCP Tasks), A2A, CloudEvents, NanoClaw, OpenClaw security model, CrewAI,
  Mastra, LangGraph, Microsoft Agent Framework, Google ADK, Temporal; research on multi-agent
  effectiveness, coordination topology, parallel execution, cost per accepted outcome, prompt
  injection, tool/skill poisoning, supply-chain security, agent evaluation, durable
  execution, human approval, long-running recovery, workspace isolation. Official specs and
  source code over marketing; no GitHub stars as evidence. Per framework: problem solved,
  layer, concept exposure, state/recovery, parallelism, approval, isolation, security,
  observability, provider dependence, licensing, runtime implications, maintenance cadence,
  migration history, failure behavior, what Construct could delete by adopting it, complexity
  added, replaceability, solo-maintainer sustainability.

## Decisions that must be made explicitly (§7)

Product definition; workspace boundary; user/trust model; embedded and shared deployment
profiles; whether Construct owns an agent loop, workflow engine, durable execution,
sandboxing, generic memory, model routing, document conversion, scheduling, provider
implementations, multi-tenancy; whether Beads is core and what one bead represents; whether
teams are core; whether roles/personas/specialists remain separate; whether Oracle remains;
whether the CLI survives; whether the flow engine survives; whether the current orchestration
runtime survives; whether the repository evolves or is replaced; initial default general and
coding runtimes; Claude/Codex/OpenHands participation; ACP/MCP/A2A participation;
CrewAI/Mastra/NanoClaw/OpenClaw/Temporal disposition; state and database technologies;
artifact storage; search/retrieval strategy; graph ontology/storage/update/gating; migration
and deletion strategy. No load-bearing decision may remain "consider later"; a deferred
decision needs a safe interim, owner, trigger, deadline, reversibility, and maximum duration.

## Target product model & work model (§8, §9)

- Validate or replace the minimum glossary: Workspace, Source, Objective, Directive, Work,
  Work Specification version, Plan version, Run, Assignment, Worker Profile, Procedure,
  Capability, Policy, Artifact, Evidence relationship, Projection, Graph node, Graph edge.
  Reject synonyms/overlaps; for each retained concept define meaning, why no existing concept
  suffices, source of truth, owner, state, lifecycle, enforcement points, extension
  mechanism, tests, migration, deletion behavior, graph representation.
- Work model: Objective (result + why), Work Specification (stable versioned agreement:
  problem, background, outcome, scope, non-goals, requirements, NFRs, acceptance criteria,
  constraints, assumptions, risks, security/privacy, required evidence, source references,
  dependencies, authority requirements, unresolved questions, impact analysis), Plan
  (versioned approach: decomposition, dependency graph, assignments, worker/capability
  requirements, runtime selection, workspace strategy, ownership boundaries, parallelization
  rationale, validation, integration, rollout, rollback, cost, graph changes), Run (one
  execution attempt: exact plan version, assignment states, runtime versions, model usage,
  checkpoints, approvals, capability calls, external effects, failures, artifacts, resource
  usage, timestamps, graph events), Artifact/Evidence (content identity, producer, inputs,
  verification, acceptance evidence, provenance, freshness, supersession, security
  classification), Projection (representation in Beads/Jira/GitHub/Linear with field
  authority and reconciliation). If Beads remains it is a projection adapter, not the domain
  model.

## Parallel execution requirements (§10)

Parallelism is a property of a Plan, not a permanent team metaphor. Support single worker,
sequential, parallel read-only research, parallel artifact production, parallel isolated code
mutation, reviewer/critic assignments, lead-and-worker topology, independent worker groups,
nested subgraphs, human-supervised concurrent sessions. Every parallel plan defines
justification, expected benefit, added cost, concurrency limit, ownership boundaries,
shared-state restrictions, communication rules, runtime selection, workspace isolation,
cancellation, timeout, retry, synthesis, merge/integration, conflict resolution, completion
conditions. Workers communicate through typed assignments, immutable artifact references,
explicit questions, bounded status events, structured handoffs, deterministic joins,
dedicated synthesis/integration nodes — not free-form agent-to-agent conversation. Concurrent
mutating workers require separate worktrees/containers, explicit ownership, scoped
credentials, resource limits, independent tests, merge candidates, conflict detection, one
authoritative integration stage, whole-system validation, rollback, cleanup, provenance. A
parent Work closes only when integration and whole-system validation succeed.

## Mandatory executable validation (§11)

Disposable, isolated spikes (never merged into production unless a later bead adopts them):

- **A — graph foundation:** prove §4 on relational SQLite/Postgres; measure build time,
  incremental update time, query latency, impact correctness, reconciliation, cycle/orphan
  detection, storage, migration burden, dependency count, cross-platform behavior.
- **B — parallel research:** lead + workers on a real research problem; prove eligibility
  decision, non-overlap, concurrency, independent artifacts, source quality, duplicate
  prevention, synthesis, conflict detection, cost/latency/evidence reporting, comparison
  against one strong worker.
- **C — parallel software change:** execution-ready work spec, graph-informed decomposition,
  concurrent safe assignments, isolated workspaces, ownership, independent tests, merge
  candidates, integration, whole-system validation, failure and conflict handling,
  provenance, no premature tracker closure.
- **D — daily workplace loop:** realistic workspace (strategy, objectives, standing
  directive, GitHub, Jira, Slack/Confluence, authority policy); prove signal detection,
  normalization, graph updates, strategy alignment, meaningful-change filtering, risk/gap
  detection, recommendation, artifact proposal, approval before external mutation, external
  effect, verification, source-linked record, no fabricated activity when nothing changed.
  Directly tests whether Construct supplies missing TPM/product capacity.
- **E — recovery:** interrupt before dispatch, during execution, after artifact production,
  before approval, during external write, before integration, during graph update; prove
  resume without repeating accepted work, idempotent effects, stale-approval handling,
  expired credentials, changed source/spec/plan, cancellation, supersession, safe cleanup,
  graph reconciliation.
- **F — runtime replacement:** upgrade or replace one runtime adapter; measure files
  changed, contracts affected, graph/test/doc changes, migration, user-facing breakage,
  rollback, ability of existing runs to finish safely.

## Evaluation framework (§12)

Version-controlled workload corpus from real Construct usage (17 workload classes from short
factual work through schema migration). Compare one strong worker, worker+procedures,
worker+deterministic control, planner+executor, lead+parallel workers, multiple peers,
current Construct, target Construct, framework-backed alternatives. Measure accepted-outcome
rate, acceptance-criteria completion, factual/citation accuracy, code correctness, regression
rate, unauthorized-effect rate, approval correctness, recovery, duplicate work, conflicts,
graph-impact accuracy, missed/false dependency rates, human intervention, latency, tokens,
cost, tool calls, retries, maintenance impact. Optimize total cost per accepted outcome. Do
not claim multi-agent superiority unless workload results prove it.

## Sustainability constraints (§13)

Per retained subsystem estimate dependency churn, schema-migration burden, protocol churn,
test burden, provider maintenance, OS support, security patch exposure, documentation,
release burden, user support, hidden infrastructure, monthly cost. Assume the maintainer may
not touch the core for weeks; providers/products/dependencies will change; partial failures
occur; no hosted control plane; embedded use requires no always-on cloud; recovery cannot
require deep Construct expertise; clean uninstall. Targets: ≤2 maintainer-days/month routine
ownership, ≤4 first-party runtime adapters, ≤2 first-party direct integration adapters, no
required graph database, no required vector database, no cloud-specific core infrastructure,
no silent shared-to-local authoritative-state fallback.

## Required outputs (§14)

1. Intent reconstruction. 2. Current-architecture truth map (implemented / partial /
disconnected / stub / unused / duplicated / deprecated / misleading / dead, graph-backed
evidence). 3. Bootstrap graph deliverable (executable builder, schema, data, query and
impact examples, contradictions, orphans, cycles, confidence model, limitations,
reproduction). 4. Load-bearing assumption register (assumption, supporting/opposing
evidence, consequence if wrong, test, result, decision). 5. Amalgamation report (parallel
architectures, duplicate contracts/state/lifecycle/extension/quality/integration systems,
orphaned abstractions, metaphors without runtime value, commands without a coherent product
role). 6. External-framework decision matrix (adopt / adopt-behind-adapter / one-worker-type
/ reference-only / reject). 7. Validation results (runnable code, commands, measurements,
failures, limitations, go/no-go; failed spikes not hidden). 8. Target product model.
9. Target conceptual model (glossary, relationships, state machines, diagrams). 10. Target
dynamic graph architecture (ontology, schemas, storage, incremental update, rebuild,
reconciliation, impact, runtime observation, work integration, beads integration, CI gates,
security, tests, migration). 11. Target work schemas with realistic examples (all 18 §8
concepts). 12. Runtime decision (custom vs adopted vs behind-adapter; initial general and
coding runtimes; per-protocol participation; rejection rationale; replacement process).
13. Retain / rebuild / replace / remove matrix over every major subsystem (purpose, use,
problems, graph dependencies, disposition, rationale, migration, deletion criteria).
14. Maintenance budget by subsystem. 15. Replacement strategy (in-place evolution vs
compatibility-backed vs parallel next-generation vs direct replacement vs hybrid; permanent
components, temporary adapters, transitional compatibility, migrated/discarded data,
removed commands/services, cleanup milestones, point of no return, rollback). 16. Executable
bead program (only after validation and target selection; actual bead records when the
environment permits, plus a neutral machine-readable export so the program is not trapped in
the tracker).

## Bead quality & parallel program rules (§15, §16)

Every bead independently executable by another model: objective, desired outcome, locked
architectural decision, requirements, acceptance criteria, context, source evidence, graph
nodes created/modified/deprecated/deleted, expected edge changes, impacted dependents,
dependency rationale, non-goals, risks, security, authority requirements, implementation
guidance, required capabilities, recommended runtime and model capability, parallelization
eligibility and rationale, workspace/worktree ownership, file ownership, inputs, outputs,
integration contract, validation, graph validation, migration, rollback, deletion/cleanup,
completion evidence. No vague beads ("implement runtime", "improve graph", "clean up old
code"). Split until executable without rediscovering the architecture, but not so finely
that integration overhead dominates. Program deliverables: complete dependency DAG, critical
path, parallel waves, file/subsystem ownership map, integration beads, migration beads,
deletion beads, validation beads, rollback beads. Same-wave beads require non-conflicting
graph neighborhoods, no shared authoritative schema mutation, no shared file ownership,
stable contracts, defined integration points, failure isolation. Per wave: max concurrency,
safe worker model, worktree/container strategy, shared read-only inputs, mutable ownership,
integration sequence, whole-system validation, cancellation. Final epic bead acceptance
criteria must be mechanically verifiable — no narrative "review everything" task.

## Initial epic structure to preserve (§17)

E0 evidence/architecture baseline → E1 dynamic graph foundation (first production epic) →
E2 workspace domain and durable storage → E3 work specification and graph-informed planning →
E4 runtime and isolation adapters (runtime contract, general/Claude/coding/process-or-ACP
runtimes, conformance suite, replacement proof) → E5 sources, directives, and workplace loop →
E6 policies, approvals, and effects (authority, policy, approval, revalidation, leases,
idempotency, transactional outbox, external verification, GitHub/Jira effects) → E7 shared
workspace (server, auth, Postgres, shared artifacts, worker claims, concurrent users,
recovery, deployment image, Docker Compose) → E8 tracker projections and migration (Beads
projection, field authority, reconciliation, importers, raw-record preservation) →
E9 cutover and deletion (CLI replacement, legacy write freeze, final migration, legacy state
removal, flow-engine deletion, Oracle deletion, specialist/persona/team deletion,
model-provider loop deletion, vector-store removal from core, deployment-mode removal, old
command removal, packaging, release, rollback proof). Structure may improve; outcomes must
be preserved.

## Execution policy & final standard (§18, §19)

Strongest reasoning model for intent reconstruction, load-bearing decisions, cross-system
synthesis, security/trust, ontology, work/state model, migration strategy, bead DAG,
critical path, adversarial final review. Smaller workers for inventory, classification,
mapping, extraction, fact collection, formatting, repetitive checks. Parallelize only
non-overlapping assignments; a strong lead defines assignments, reviews evidence, resolves
conflicts, decides, compiles the final architecture and bead program. The correct outcome is
not "Construct, but cleaner", a larger organization simulation, a framework wrapped in a
framework, a static diagram, an additive roadmap leaving the old system in place, partially
connected beads, a generic agent platform, Kubernetes, or an unmaintainable hosted service.
It is a workspace-level system with a day-one dynamic graph, dependency-checked changes,
replaceable runtimes, durable governed outcomes, product/TPM capacity across real workplace
systems, safe parallel execution, explicit integration, tracker independence, strong
evidence and provenance, one product model across embedded and shared deployments,
aggressive deletion of superseded architecture, and a complete bead program another model
can execute in parallel. Challenge every load-bearing assumption; prefer evidence over
confident prose, contracts over framework leakage, graph-backed dependencies over manual
lists, isolated mutation over shared workspaces, deletion over compatibility without
expiration, and a system that stays dependable while its maintainer is busy living and
working.
