# Architecture after the cutover

## Chosen direction

Construct is a smaller project-aware operating layer. The host owns model
execution and sandboxing. Construct owns context admission, bounded work,
bindings, evidence, and trust. Native work replaces the external tracker.
State format 3 is additive over format 2 (one-way).

## Kept foundations

Transactional SQLite state, project binding, source authority, leases and
fencing, provenance columns, and the split between execution completion and
acceptance.

## Rejected alternatives

Installing another tracker, keeping dual writes, a second agent runtime,
automatic provider switching, a resident daemon, and treating the JSONL
export as live truth.

## Risks

- Live tracker cutover needs exclusive snapshot of the embedded Dolt
  backend. An export-only import discloses coverage.
- Custom JSON-RPC remains until the official MCP SDK is locked against
  supported hosts; domain contracts stay in Construct.
- Routing evals are not outcome evals.

## Ownership map (compact)

| Concern | Entrypoint | Store | Enforcement |
|---|---|---|---|
| Discovery | `gatherProjectMaterial` | statements on apply | containment + caps |
| Admission | `applyDiscoveryDraft` / `bindGoverningStatement` | statements, entities | provenance required |
| Sources | `createSourceService` | snapshots, claims | reader missing = unreachable |
| Work | `kernel/work` + CLI `work` + tool `work` | work_* tables | revision + claim token |
| Runs | workflow service | workflow_runs, step_runs | frozen bindings |
| Trust | promote_deliverable | deliverables | person actor only |
