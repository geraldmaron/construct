<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0053: Living graph architecture — LMCP-A3

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0019 (execution-capability descriptive contract), ADR-0044 (tool/repo root layout), ADR-0048 (semantic tool discovery), ADR-0052 (unified provider manifest)
- **Tracking**: LMCP-A3

## Problem

`lib/graph` is disconnected from the runtime. It has no representation of providers, tools, or packs; its staleness check covers only three seed files; and neither `construct status` nor `construct doctor` reads from it. The graph is a structural artifact that does not reflect the system it is meant to describe, which means it cannot be used as a CI gate or as a truth source for operational tooling.

Specific evidence:

- `lib/graph/build-from-registry.mjs` — node types supported: `file`, `module`, `workflow`, `capability`, `test`, `contract`, `surface`, `skill`, `rule`; no `provider`, `tool`, `pack`, `doc`, `specialist`, or `runtime-evidence` nodes
- `lib/graph/build-from-registry.mjs:151` — `sourceHash` covers only 3 seed files; graph reports itself current even when the majority of source files have changed
- `lib/graph/cli.mjs:95` — CLI surface is `construct matrix build|stat|query`; `construct graph` does not yet exist as primary
- `construct status` and `construct doctor` do not read the graph JSONL store; health verdicts are computed from other sources only

The consequence is that the graph cannot serve its intended purpose: catching missing dependencies between workflows and their required providers, flagging stale capability declarations, or confirming system integrity before a push.

## Decision

Extend the existing JSONL store at `.cx/graph/` with a richer node and edge taxonomy, enforce rebuild triggers, expand the staleness model to cover all source files, introduce a CI drift gate, and integrate the graph verdict into `construct doctor`.

### Extended node taxonomy

Existing node types are preserved. The following are added:

| Node type | Description |
|-----------|-------------|
| `provider` | A provider manifest (from ADR-0052); keyed by manifest `id` |
| `tool` | An MCP-tool or capability token contributed by a provider |
| `pack` | A specialist-pack, team-pack, or profile-pack manifest |
| `doc` | A documentation file (`docs/**`) tracked for link integrity |
| `specialist` | A specialist persona definition |
| `runtime-evidence` | A telemetry or run-log artifact that evidences system behavior |
| `embed` | An embed-capability preset (a `type:"embed"` manifest, ADR-0061); keyed by manifest `id`. Seeded from embed manifests (LMCP-P6) with `uses`→provider, `owned_by`→specialist, `governed_by`→contract edges, and an inbound `validates` edge from its `@embed`-tagged acceptance test |

### Extended edge taxonomy

Existing edge types are preserved. The following are added:

| Edge type | Meaning |
|-----------|---------|
| `requires` | Source node depends on target node being present and healthy |
| `documents` | A `doc` node documents a `module`, `workflow`, or `provider` node |
| `evidenced_by` | A claim node is evidenced by a `runtime-evidence` node |
| `contributes_to` | A `provider` or `pack` node contributes capabilities to a `workflow` or `surface` |
| `degraded_by` | A node's health is degraded when target node is absent or unhealthy |

### Rebuild triggers

The graph is rebuilt automatically in three situations:

1. **Git commit hook** — if the graph JSONL is older than any source file in scope of the commit (checked via `git diff --name-only HEAD`)
2. **`construct graph build`** — explicit rebuild; always runs to completion regardless of staleness
3. **`npm test` pre-check** — if the graph is stale (staleness check below), tests emit a warning and rebuild before continuing; they do not fail on staleness alone

### Staleness model

`sourceHash` is expanded from 3 seeds to cover **all files that contribute nodes or edges** to the graph: all manifests in `lib/manifests/`, all skill files, all rule files, all workflow definitions, all provider registry files, and all source files with a `@graph-node` or `@graph-edge` JSDoc annotation. A change to any of these files marks the graph stale.

### Graph-validate contract

`construct graph validate` enforces the following:

| Check | Solo mode | Team/enterprise mode |
|-------|-----------|----------------------|
| Missing `requires` edge for a workflow's declared providers | warning | error |
| Provider node present but no matching manifest on disk | warning | error |
| `doc` node references a file that does not exist | warning | error |
| `embed` binding target (`uses`/`owned_by`/`governed_by`) has no node (LMCP-P6) | warning | error |
| `embed` preset has zero validating tests (LMCP-P6) | warning | error |
| `degraded_by` edge target is absent | info | warning |
| `evidenced_by` edge with no corresponding run log | info | info |

### CLI naming

- `construct graph` is the primary CLI surface (`build`, `stat`, `query`, `validate`)
- `construct matrix` becomes an alias; it emits a deprecation warning and will be removed after 2 release cycles
- `construct matrix build|stat|query` continue to work unchanged during the deprecation window

### CI drift gate

`construct graph validate --strict` exits non-zero if **any error-class link is absent** (per the table above, error-class varies by deployment mode). Warning-class links emit to stderr but do not affect exit code. The gate is intended for CI `on: push` workflows; it is not run by default in `npm test`.

### Doctor integration

`construct doctor` reads the graph JSONL store and reports:

- **stale**: graph is older than source files in scope; recommend `construct graph build`
- **invalid**: `construct graph validate` returned errors; list the first five error messages
- **healthy**: graph is current and valid

## Alternatives considered

- **Keep the graph as-is and add separate provider/tool registries**: avoids extending the graph schema but creates yet another disconnected registry (the exact problem ADR-0052 addresses). Rejected.

- **Replace the JSONL store with a SQLite graph DB**: provides richer query capability and referential integrity. Rejected because it adds a binary dependency and makes the graph non-human-readable and not git-diffable; the JSONL format is intentional for auditability.

- **Remove `construct matrix` immediately**: simpler, but breaks any existing scripts or CI configs that invoke it. Rejected; a two-release deprecation window is sufficient notice.

## Consequences

- The graph becomes a live artifact: it is rebuilt on commit and validated in CI, not only built on demand.
- `construct doctor` gains a graph-health signal; operators see staleness and validity at a glance.
- `construct matrix` is deprecated with a warning; `construct graph` is the documented primary surface going forward.

## Removal (2026-07-18)

The deprecation window this ADR set has closed. `construct matrix` shipped as a warning-emitting alias in v1.5.0 and was removed in `construct-b0nny.28` (workspace-control-plane E9), six releases later — past the two release cycles decided above. `construct graph` is the sole dependency-graph surface, and the stale `construct matrix build` hints in error messages, hook advisories, and doctor watchers were repointed to `construct graph build`. References to the command below are the historical record of the decision, not live guidance.
- The staleness model covers all source files that contribute to the graph, eliminating false "current" verdicts.
- Missing provider dependencies in workflows are surfaced as errors in team/enterprise CI before they cause runtime failures.
- LMCP-C1..C9 (graph schema extension, rebuild triggers, validate contract, CI gate, doctor integration) and LMCP-K1 (graph-backed capability resolution) are unblocked by this decision.
