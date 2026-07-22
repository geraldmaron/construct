# ADR-0046: Modular org layout with runtime registry merge

> **Obsolete paths (Construct 2.0):** `specialists/org/**`, `specialists/unified-registry.json`, and `.cx/org/` overlays are retired. Live registry roots are `registry/worker-profiles/`, `registry/workspace-presets/`, and project state under `.construct/`. Body below is the original modular-layout decision. See `docs/obsolete/legacy-surface-register.md`.

- **Date**: 2026-06-26
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), cx-architect
- **Amends**: [RFC-0004](../rfc/0004-team-orchestration-integration.md) storage decision only

## Problem

[RFC-0004](../rfc/0004-team-orchestration-integration.md) consolidated five fragmented registries into a single `specialists/unified-registry.json`. That fixed validation and orchestration wiring, but the monolith is now ~4.6k lines: hard to review in PRs, impossible to assign squad ownership, and it encodes only one organizational level (macro groups). Product work needs a finer squad layer (e.g. Product Management squad with PM flavor overlays collaborating with UX Research and Design squads under Product Group).

Direct reads of the JSON file appear in ~100 call sites (`rg 'specialists/unified-registry.json'` audit, 2026-06-26). Edits require whole-file merges and invite silent cross-team drift.

## Decision

1. **Modular sources on disk** under `specialists/org/`:
   - `groups/*.json` — macro groups (`kind: group`) with group-level decision rights and `squads[]`
   - `teams/*.json` — functional squads (`kind: squad`) with `groupId`, `roles[]`, `collaborators[]`, `specialists[]`
   - `specialists/*.json` — one file per `cx-*` with `teamId` (squad) and `groupId` (denormalized)
   - `contracts/*.json`, `policies/*.json` — one entity per file

2. **Runtime merge** — `lib/registry/loader.mjs` `assembleRegistry(rootDir)` walks the tree, merges `.cx/org/` overlay, validates, and caches by directory mtime. No committed monolithic JSON is the source of truth.

3. **Assembled registry v3** — in-memory shape matches v2 (`teams`, `specialists`, `contracts`, `policies`) with `version: 3`. The `teams` map contains both groups and squads discriminated by `kind`. Specialist `team` field references the **squad** id.

4. **Pilot squad split** — Product Group splits into five squads; other macro groups start as one squad each until refined.

Orchestration, fences, contracts, Oracle, and MCP read through `loadRegistry()` only. Validation invariants from RFC-0004 are preserved; group entries skip the "must have direct specialists" rule when they declare `squads[]`.

## Rationale

Modular files match how skills already live (`skills/**` with inventory snapshot). Runtime merge avoids dual-write drift between a compiled artifact and sources. Two-level org models real collaboration (squads) without losing macro decision rights (groups). Keeping the assembled object shape minimizes consumer churn.

## Consequences

- **Positive**: Per-squad PRs; squad charters and collaborators are first-class; loader is the single read path.
- **Negative**: One-time migration of ~100 direct JSON readers; validator gains group/squad branches.
- **Neutral**: Contract `teamBoundary` continues to reference **group** ids; routing adds `groupId` + `squadId` on `teamRouting`.

## Migration

1. Run `node scripts/migrate-org-modular.mjs` to emit `specialists/org/**` from the legacy monolith.
2. Switch `loadRegistry()` to `assembleRegistry()`.
3. Delete `specialists/unified-registry.json`; retain `scripts/migrate-org-modular.mjs` for reference.
4. Update [docs/guides/concepts/teams.md](../../guides/concepts/teams.md) and architecture docs.

## Evidence

- Loader audit: `lib/registry/loader.mjs` (pre-change) read only `specialists/unified-registry.json`.
- Team/specialist counts: 6 macro groups, 29 specialists (2026-06-26).
- Tests: `tests/registry-runtime-merge.test.mjs`, `tests/registry-loader.test.mjs`.
