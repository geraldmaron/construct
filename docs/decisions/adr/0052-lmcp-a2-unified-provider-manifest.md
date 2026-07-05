<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0052: Unified extension/provider manifest architecture — LMCP-A2

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0019 (execution-capability descriptive contract), ADR-0021 (provider worker backend), ADR-0048 (semantic tool discovery), ADR-0050 (worker-scoped governed web capability)
- **Tracking**: LMCP-A2

## Problem

Construct has nine or more independent registries, each maintaining a hardcoded extension list. Users cannot add providers, MCP tools, document renderers, or specialist packs without forking core. Maintenance of these registries is fragmented and error-prone:

- `lib/providers/registry.mjs:32` — `BUILT_INS` array is hardcoded; new model providers require a core edit
- `lib/embed/providers/registry.mjs:82-113` — embed provider registry uses env-driven hardcoded conditional imports
- `lib/mcp/server.mjs` — 75+ hardcoded tool definitions; adding a tool requires editing this file
- `lib/mcp-catalog.json` and the plugin-registry constitute two separate, unsynchronized lists of MCP-visible tools
- `lib/document-export.mjs:39-53` — `FORMAT_ENGINES` dictionary hardcodes all export format handlers
- `lib/registry/surface-map.mjs:17-59` — `COMMAND_SURFACE` dictionary hardcodes all CLI surface mappings
- `lib/models/catalog.mjs` — model catalog is separate from the provider registry, creating a second source of truth for model capability metadata

The result is that every category of extension (model, tool, renderer, specialist pack, team configuration) requires a different code path to add, and all of them require a core edit. There is no user-land or project-scoped extension point.

## Decision

Define a **single manifest schema** for all provider kinds, loaded from a priority-ordered set of directories. A manifest is a JSON (or JSON5/YAML) file that describes one extension unit; the registry is the union of all discovered manifests.

### Manifest schema

```jsonc
{
  "id": "string",                   // globally unique, e.g. "anthropic", "web-search-gov"
  "version": "string",              // semver
  "kind": "...",                    // see Kind enum below
  "capabilities": ["string"],       // declared capability tokens
  "configSchema": {},               // JSON Schema for operator configuration
  "secretEnvKeys": ["string"],      // env var names that carry credentials
  "modes": ["string"],              // deployment modes where this manifest is active
  "surfaces": ["string"],           // CLI/MCP surfaces this provider contributes to
  "operations": ["string"],         // operation tokens this provider can fulfill
  "healthCheck": "string",          // module path exporting async healthCheck()
  "dryRun": true,                   // whether provider supports dry-run execution
  "idempotency": "string",          // "full" | "best-effort" | "none"
  "rateLimit": {},                  // { requests, window, burst }
  "retry": {},                      // { maxAttempts, backoff }
  "degradation": "string",          // "skip" | "error" | "fallback:<id>"
  "securityClassification": "string", // "trusted" | "governed" | "untrusted"
  "approvalRequirements": ["string"], // approval boundary tokens
  "tests": ["string"],              // module paths for provider-supplied integration tests
  "docs": "string",                 // URL or relative path to provider documentation
  "owner": "string",                // team or individual owner identifier
  "compatVersion": "string",        // minimum Construct core version required
  "installSource": "string",        // "builtin" | "user" | "project"
  "removalStatus": "string"         // null | "deprecated" | "removed"
}
```

### Kind enum

| Kind | Description |
|------|-------------|
| `model` | LLM or embedding model provider |
| `data-source` | Read-only external data connector |
| `external-write` | Write-capable external integration |
| `embed-index` | Embedding index / vector store backend |
| `mcp-tool` | MCP-protocol tool |
| `storage` | Persistent storage backend |
| `queue` | Work queue backend (git-queue, Postgres, etc.) |
| `telemetry` | Observability/metrics sink |
| `artifact-renderer` | Document export format handler |
| `specialist-pack` | Curated set of specialist personas |
| `team-pack` | Team-scoped configuration bundle |
| `profile-pack` | User profile / persona configuration |
| `host-adapter` | IDE/host integration adapter |

### Load order

1. **builtin** — manifests embedded in the Construct package (`lib/manifests/`)
2. **user** — manifests in `~/.config/construct/providers/`
3. **project** — manifests in `.cx/providers/` (git-tracked, project-scoped)

Later entries in load order override earlier entries for the same `id`. An unknown `kind` value causes the manifest to be skipped with a warning, not a fatal error.

### Registry migration plan

| Current registry | Migration disposition |
|------------------|-----------------------|
| `lib/providers/registry.mjs` `BUILT_INS` | Becomes a bridge that loads built-in model manifests; `BUILT_INS` array is removed |
| `lib/embed/providers/registry.mjs` | Bridge to embed-index kind manifests; env-driven conditional imports replaced by manifest `configSchema` + `secretEnvKeys` |
| `lib/mcp/server.mjs` tool defs | Each tool becomes an `mcp-tool` kind manifest; server.mjs becomes a loader |
| `lib/mcp-catalog.json` | Migrated to individual manifests; catalog file becomes a generated index (not hand-edited) |
| plugin-registry | Merged into the manifest system; plugin entries become manifests |
| `lib/document-export.mjs` `FORMAT_ENGINES` | Each format handler becomes an `artifact-renderer` kind manifest |
| `lib/registry/surface-map.mjs` `COMMAND_SURFACE` | Surface contributions expressed in manifests' `surfaces` field |
| `lib/models/catalog.mjs` | Model metadata migrated to `model` kind manifests |

**Only adding a new `kind` value to the Kind enum requires a core edit.** Everything else — new providers, new tools, new renderers — is a new manifest file.

## Alternatives considered

- **Per-category registries (status quo)**: keep each registry independent and document them. Rejected because it does not solve the user extensibility problem; it only codifies fragmentation.

- **Plugin system with npm packages**: providers are npm packages with a well-known export. Provides maximum flexibility but requires npm install for every extension and makes project-scoped extensions (`.cx/providers/`) awkward. Rejected as the primary mechanism; npm packages can produce manifests and are a valid `installSource`.

- **Environment-variable-only configuration**: new providers are configured entirely via env vars, no manifest files. Rejected because it cannot express capability metadata, security classification, approval requirements, or degradation behavior that the orchestration runtime needs.

## Consequences

- User-land and project-scoped extension is possible without forking core: drop a manifest file in `~/.config/construct/providers/` or `.cx/providers/`.
- All nine registries gain a migration path; the migration is incremental — bridges allow old and new code to coexist during the rollout.
- The `kind` enum is the only extension point that requires a core edit; all other extension is data-driven.
- LMCP-B1..B9 (manifest schema, loader, registry bridges, per-kind migrations), LMCP-D1 (project-scoped provider discovery), and LMCP-E1 (manifest validation CI gate) are unblocked by this decision.
