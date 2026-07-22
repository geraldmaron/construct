<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0054: LMCP-A4 — Workflow manifest schema and workflow-defs normalization

> **Current surface (Construct 2.0):** Operator-facing "workflows" are **Procedures** under `registry/procedures/`, invoked via `construct procedure` / MCP `procedure_invoke`. Paths `.cx/workflows/`, CLI `construct workflow`, and MCP `workflow_invoke` are retired. This ADR's manifest-schema decision remains historical/architectural context for catalog shape — not a runbook for `workflow-defs.mjs` hand-edits. See `docs/obsolete/legacy-surface-register.md`.

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0020 (local orchestration runtime), ADR-0021 (provider worker backend), ADR-0033 (platform capability registry), ADR-0046 (modular org runtime merge)
- **Tracking**: LMCP-A4 (epic: Living Modular Control Plane)

## Problem

Eleven workflows are hardcoded in `lib/embedded-contract/workflow-defs.mjs:13-84`. The
catalog encodes tier, `defaultApprovalMode`, role chain, and output schema as static
JavaScript object literals. Teams and pack authors cannot add, swap, or override
workflows without forking the core package. Two downstream maps compound the rigidity:

- The intake-to-workflow routing table at `:90-107` is also a hardcoded literal — adding
  a workflow type requires editing two locations in the same file.
- `workflow-defs.mjs` is consumed directly by graph build, the capability map, and
  `workflow-invoke`. Any schema change requires coordinated edits across all consumers
  with no version signal.

There is no declared schema, no versioning, no pack contribution point, and no override
mechanism. This is the root cause blocking pack extensibility (LMCP-E1), workflow graph
generation (LMCP-D1..D4), and any team-specific workflow customization.

## Decision

### Manifest schema

Define a **workflow manifest** as a JSON document with the following fields:

```jsonc
{
  "id": "string",                        // stable slug, e.g. "prd-draft"
  "version": "string",                   // semver of this manifest revision
  "type": "linear|routing|orchestrator-worker|evaluator-loop|pipeline",
  "modes": ["string"],                   // e.g. ["solo", "team", "enterprise"]
  "surfaces": ["string"],                // e.g. ["mcp", "cli", "api"]
  "inputSchema": {},                     // JSON Schema for workflow input
  "outputSchema": {},                    // JSON Schema for workflow output
  "roleChain": ["string"],               // ordered specialist ids
  "packRequirements": ["string"],        // pack ids that must be installed
  "providerRequirements": {},            // e.g. { "minTier": "standard" }
  "toolGrants": ["string"],              // tools available to this workflow
  "policyGates": ["string"],             // named gates that must pass
  "defaultApprovalMode": "string",       // proposal-only | requires-human-approval | allow-durable-write
  "durableStateModel": "string",         // none | git-queue | in-process
  "telemetryEvents": ["string"],         // event names emitted by this workflow
  "tests": ["string"],                   // paths to integration test fixtures
  "docs": "string",                      // path or URL to workflow documentation
  "examples": [{}],                      // illustrative input/output pairs
  "degradation": {},                     // degraded-mode behavior spec
  "owner": "string",                     // team or pack id that owns this workflow
  "compatVersion": "string"             // minimum construct core version required
}
```

All fields are optional except `id`, `version`, `type`, and `defaultApprovalMode`.
Unrecognized fields are ignored by the loader (forward-compat), and missing optional
fields use documented defaults.

### Storage locations and merge precedence

Manifests are discovered from three locations and merged by `id` with explicit
precedence (higher wins):

1. **Project overrides** — `.cx/workflows/*.manifest.json` (highest)
2. **Pack contributions** — `{pack_root}/workflows/*.manifest.json`
3. **Built-in catalog** — `lib/embedded-contract/workflows/*.manifest.json` (lowest)

When two sources declare the same `id`, the higher-precedence source wins in full
(field-level merging is not supported; an override must be a complete manifest). The
loader records which source won for each id in the resolved catalog and surfaces
conflicts as warnings when `CONSTRUCT_DEBUG` is set.

### Disposition of `workflow-defs.mjs`

`lib/embedded-contract/workflow-defs.mjs` becomes a **generated artifact**:

- `construct graph build` reads all manifests from the three locations, validates
  them against the manifest schema, and writes the merged catalog to
  `workflow-defs.mjs` (or a build-time JSON equivalent consumed by the runtime).
- A **thin compat shim** re-exports the generated catalog at the existing module path
  so all current consumers (`graph build`, capability map, `workflow-invoke`) continue
  to import without change during the migration window.
- Hand-editing `workflow-defs.mjs` is **deprecated** once LMCP-D2 lands; the file
  carries a generated header warning. Direct edits will be overwritten on the next
  `construct graph build` run.
- The compat shim and `workflow-defs.mjs` as a hand-editable file are **removed in
  LMCP-D4** once all consumers import from the manifest-aware loader directly.
- The intake-to-workflow routing table (`:90-107`) is replaced by a `surfaces` +
  `modes` index derived from manifests at build time; no separate routing table is
  maintained by hand.

### Validation

The loader validates each manifest against the schema on load:

- Unknown `type` values → hard error (fail-closed).
- `compatVersion` outside the running core version range → hard error with a clear
  message naming the manifest file and the version mismatch.
- `roleChain` references a specialist id that is not installed → warning in solo
  mode, hard error in team/enterprise.
- Schema validation errors → hard error; malformed manifests are never silently
  skipped.

## Rejected alternatives

- **Keep the hardcoded catalog and add a plugin registration function.** A JS
  `registerWorkflow(def)` call at import time avoids files on disk. Rejected: it
  requires pack authors to ship JS that runs in the core process, raises security
  concerns, makes order-of-import significant, and prevents static analysis of what
  workflows are installed. File-based manifests are inspectable, diffable, and
  auditable without executing code.

- **Single merged JSON file written by pack install.** One `workflows.json` file that
  pack install rewrites on each install. Rejected: concurrent installs race, git diffs
  are noisy, and the file cannot be overridden per-project without replacing the entire
  catalog. The three-location precedence model composes cleanly.

- **Extend the existing `workflow-defs.mjs` schema in place with a version field.**
  Add `version` and `owner` to the current static objects. Rejected: it does not solve
  the extensibility problem (still requires a fork to add workflows), does not provide
  a pack contribution point, and does not enable the graph-build pipeline that
  LMCP-D1..D4 depends on.

## Consequences

- Pack authors can contribute new workflow types by shipping a `workflows/*.manifest.json`
  under their pack root — no core fork required.
- Project teams can override any built-in workflow's defaults (approval mode, role chain,
  policy gates) without touching the package by placing a manifest in `.cx/workflows/`.
- `workflow-defs.mjs` is regenerated on `construct graph build`; CI should run graph build
  and assert the committed file matches the generated output (drift detection).
- The compat shim means zero consumer changes during the migration window; LMCP-D1..D4
  can land incrementally.
- Removing the shim in LMCP-D4 is a breaking internal API change — consumers must
  migrate to the manifest-aware loader before D4 lands.
- The intake-to-workflow routing table becomes a derived index; removing it from
  `workflow-defs.mjs` is part of the LMCP-D2 scope.

**Unblocks**: LMCP-D1, LMCP-D2, LMCP-D3, LMCP-D4, LMCP-E1
