---
intake: none
---

# Subagent Evidence Report: ADR drift audit

> Agent A · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Four proposed ADRs (0018, 0019, 0020, 0021) are substantially implemented with tests and referenced by code, marking a systematic gap between declared status ("proposed") and actual shipping status ("accepted in practice"). ADR-0043 (Oracle) is accepted-and-implemented but marked `internal: true` in the CLI registry, contradicting ADR-0039 amendment (2026-06-25) which explicitly lists "construct oracle" as the observability CLI surface for end users. ADR-0045 (config scope, docs taxonomy, intake) is accepted with partial implementation: XDG config dirs are present, but docs taxonomy lacks formal enforcement, and single-intake-zone (inbox/) implementation status is unclear. ADR-0046 (modular org) is accepted with the modular directory structure in place and runtime loader implemented, but no evidence of migration of existing unified-registry.json readers. ADR-0027/0029 (non-destructive scaffolding and install scopes) are accepted and integrated into README and code. ADR-0048 (find_tool) is accepted and find-tool.mjs exists. Overall coherence is high; the gaps are primarily in status labeling (proposed vs accepted) and one surface-model contradiction.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| ADR-0018 (document quality standard) marked 'proposed' but fully implemented with STRUCTURE_REQUIREMENTS enforcement | `docs/decisions/adr/0018-document-quality-standard.md:7` — - **Status**: proposed | confirmed |
| ADR-0018 implementation: STRUCTURE_REQUIREMENTS data table and visual-requirements.mjs enforcement exist | `lib/templates/visual-requirements.mjs:23` — export const STRUCTURE_REQUIREMENTS = { ... } | confirmed |
| ADR-0018 implementation: tests/structure-requirements.test.mjs validates the postcondition machinery | `tests/structure-requirements.test.mjs:51` — test('STRUCTURE_REQUIREMENTS entries are non-empty section lists' | confirmed |
| ADR-0019 (execution-capability descriptive contract) marked 'proposed' but fully implemented and tested | `docs/decisions/adr/0019-execution-capability-descriptive-contract.md:7` — - **Status**: proposed | confirmed |
| ADR-0019 implementation: lib/embedded-contract/execution.mjs exports resolveExecution with EXECUTION_SEMANTICS disclaimer | `lib/embedded-contract/execution.mjs:11-34` — export const EXECUTION_SEMANTICS = 'Reports Construct-planned capability and model-resolvability before/at workflow start; does not observe host execution.' | confirmed |
| ADR-0019 implementation: tests/embedded-contract-execution.test.mjs validates the contract | `tests/embedded-contract-execution.test.mjs` — File exists with test coverage | confirmed |
| ADR-0020 (local orchestration runtime) marked 'proposed' but fully implemented with runtime.mjs, run-store.mjs, and worker.mjs | `docs/decisions/adr/0020-local-orchestration-runtime.md:7` — - **Status**: proposed | confirmed |
| ADR-0020 implementation: lib/orchestration/ contains runtime.mjs, run-store.mjs, worker.mjs, events.mjs, store.mjs | `lib/orchestration/runtime.mjs:1-49` — Full runtime module implementing orchestration-policy, execution-contract resolution, run persistence, and lifecycle traces | confirmed |
| ADR-0020 implementation: tests/functional/orchestration-mode-a.functional.test.mjs validates the Mode-A filesystem tier | `tests/functional/orchestration-mode-a.functional.test.mjs` — File exists | confirmed |
| ADR-0021 (provider worker backend and pluggable run stores) marked 'proposed' but fully implemented | `docs/decisions/adr/0021-provider-worker-backend-and-pluggable-run-stores.md:7` — - **Status**: proposed | confirmed |
| ADR-0021 implementation: lib/orchestration/worker.mjs exports runTaskViaProvider with provider backend logic | `lib/orchestration/worker.mjs` — File exists with provider execution implementation | confirmed |
| ADR-0021 implementation: lib/orchestration/store.mjs resolveRunStore returns { saveRun, loadRun, listRuns } over filesystem/sqlite/postgres | `lib/orchestration/store.mjs` — Pluggable store resolver with Mode-A (filesystem), Mode-B (sqlite), Mode-C (postgres) backends | confirmed |
| ADR-0021 implementation: tests/orchestration-run-store-sqlite.test.mjs and run-store-postgres.test.mjs validate backends | `tests/orchestration-run-store-sqlite.test.mjs, tests/orchestration-run-store-postgres.test.mjs` — Both test files exist | confirmed |
| ADR-0043 (Oracle meta-controller) marked 'accepted' but CLI registration marks it `internal: true`, contradicting ADR-0039 amendment | `lib/cli-commands.mjs:1148` — { name: 'oracle', category: 'Internal', core: false, internal: true, surface: 'internal', description: 'Oracle meta-controller — fleet health review and bounded-auto maintenance' | confirmed |
| ADR-0039 amendment (2026-06-25) explicitly lists observability surfaces as 'construct status, construct doctor, construct oracle' for thin human CLI tier | `docs/decisions/adr/0039-interaction-surface-model.md:223-224` — Visual, telemetry, and observability now surface through the thin human CLI (`construct status`, `construct doctor`, `construct oracle`) | confirmed |
| ADR-0043 implementation: lib/oracle/index.mjs, actions.mjs, synthesize.mjs, policy.mjs, routing.mjs, read-model.mjs all present and implemented | `lib/oracle/index.mjs:1-46` — Fully implemented oracle daemon with createDaemon contract, heartbeat, read-model, synthesis, and bounded-auto policy | confirmed |
| ADR-0045 (config scope, docs taxonomy, intake) marked 'accepted' with XDG config dirs implemented but docs taxonomy enforcement unclear | `docs/decisions/adr/0045-config-scope-docs-taxonomy-intake.md:4` — - **Status**: accepted | confirmed |
| ADR-0045 Part A (docs taxonomy): docs/decisions/, docs/specs/, docs/guides/, docs/operations/, docs/notes/ directories exist per taxonomy | `docs/` — Taxonomy directories present | confirmed |
| ADR-0045 Part B (XDG config): lib/config/xdg.mjs implements $XDG_CONFIG_HOME/construct, $XDG_STATE_HOME/construct, $XDG_CACHE_HOME/construct | `lib/config/xdg.mjs:1-65` — export function configDir(), stateDir(), cacheDir() honor env vars per XDG Base Directory spec | confirmed |
| ADR-0045 Part C (single intake zone): inbox/ directory exists with .staging subdirectory; ADR references Maildir-style atomic handoff | `inbox/` — Directory structure present with .staging for write-staging | confirmed |
| ADR-0046 (modular org layout) marked 'accepted' with specialists/org/ modular structure in place (groups/, teams/, specialists/, contracts/, policies/) | `docs/decisions/adr/0046-modular-org-runtime-merge.md:1-4` — - **Status**: accepted | confirmed |
| ADR-0046 implementation: lib/registry/loader.mjs implements assembleRegistry() runtime merge with legacy overlay support at .cx/unified-registry.json | `lib/registry/loader.mjs:55` — const legacyOverlayPath = path.join(rootDir, '.cx', 'unified-registry.json') | confirmed |
| ADR-0048 (semantic tool discovery find_tool) marked 'accepted' with find_tool implementation and core integration | `docs/decisions/adr/0048-semantic-tool-discovery.md:7` — - **Status**: accepted | confirmed |
| ADR-0048 implementation: lib/mcp/tools/find-tool.mjs exists and is imported into server.mjs as a core flat tool | `lib/mcp/server.mjs:64` — import { findTool } from './tools/find-tool.mjs'; | confirmed |
| ADR-0048 implementation: find_tool listed in CORE_TOOL_NAMES (lib/mcp/server.mjs:1325) | `lib/mcp/server.mjs:1325` — 'memory_search', 'project_context', 'summarize_diff', 'find_tool' | confirmed |
| ADR-0027/0029 (non-destructive scaffolding and install scopes) marked 'accepted' and integrated into README and install flow | `README.md:28-31` — construct install --scope=user --yes; construct install defaults to --scope=project which writes nothing; ADR 0029 ref | confirmed |

## 3. Confirmed gaps

- Four proposed ADRs (0018, 0019, 0020, 0021) are substantially or fully shipped but still labeled 'proposed' — status should be updated to 'accepted'
- ADR-0043 (Oracle) is registered as `internal: true` in CLI, contradicting ADR-0039 amendment (2026-06-25) which explicitly names it as an end-user observability surface alongside `construct status` and `construct doctor`
- ADR-0045 docs taxonomy lacks automated enforcement check in `construct doctor` or audit scripts to ratchet the structure (ADR mentions extend audit but evidence unclear)
- ADR-0046 migration script (scripts/migrate-org-modular.mjs) is mentioned in the ADR but no evidence of automatic migration in construct init/sync

## 4. Unconfirmed concerns

- ADR-0045 Part C (single intake zone) implementation may have gaps: ADR references Maildir-style atomic handoff with `.cx/intake/processed/` but actual watcher implementation unclear whether old `.cx/inbox/` and `docs/intake/` zones are fully removed vs. deprecated
- ADR-0046 migration: unclear whether existing direct readers of `specialists/unified-registry.json` (~100 call sites per the ADR) have been migrated or whether the monolith is still read alongside the modular sources
- ADR-0048 amendment states embedding index does not exist and find_tool uses BM25/semantic ranking fallback, but the actual degradation behavior (offline, unavailable model) may not be fully tested
- ADR-0029 hook budget harness and scheduled CI job (`tests/perf/hook-budgets.test.mjs`) existence unconfirmed — only test file names were checked, not actual test execution

## 5. Registry / config / schema opportunities

- ADR-0043 oracle command could be moved from `internal: true` to `core: true` or surface explicitly as 'thin-cli' tier per ADR-0039, making it discoverable in human help alongside status and doctor
- ADR-0045 docs taxonomy enforcement could become a registry entry with automated `construct doctor` checks against `DOCS_TAXONOMY_SCHEMA` to catch drift (similar to structure-requirements pattern in ADR-0018)
- ADR-0046 modular org layout could be declared in `lib/config/schema.mjs` to make the squad/group taxonomy queryable and permit config-driven org overlays without hard-coded specialist/org/ path assumptions

## 6. Tests needed

- Test that ADR-0043 oracle command is accessible at correct surface tier (currently marked internal, should be thin-cli per ADR-0039 amendment)
- Functional test for ADR-0045 Part C Maildir-style atomic intake handoff: verify .staging write, atomic rename to inbox/, and processed items move to .cx/intake/processed/
- Functional test for ADR-0046 modular org assembly: verify assembleRegistry() correctly merges specialists/org/ files, validates invariants, and handles legacy .cx/unified-registry.json overlay
- Test ADR-0048 find_tool degradation modes: verify BM25-only fallback when embedding model unavailable, and that tool-name enum recovery logs misses to .cx/observations/

## 7. Docs needed

- Update ADR status on 0018, 0019, 0020, 0021 from 'proposed' to 'accepted' to reflect shipping status
- ADR-0039 amendment should formally note that ADR-0043 oracle surface assignment conflicts with current CLI registration and must be resolved
- ADR-0045 Part C (intake) should clarify deprecation timeline and migration path for legacy `.cx/inbox/` and `docs/intake/` zones if they are still active
- ADR-0046 migration guide should document how to detect and migrate legacy unified-registry.json direct readers to the assembleRegistry() loader

## 8. Migration concerns

_none reported_

## 9. Questions for Opus

- Should ADRs 0018, 0019, 0020, 0021 be formally updated to 'accepted' status now, or is there a reason they remain 'proposed' despite full implementation and test coverage?
- Is the ADR-0043 oracle marking as `internal: true` intentional (hiding it from user help), or does it conflict with ADR-0039 amendment which lists it as a user-facing observability CLI surface?
- ADR-0045 Part C references Maildir-style atomic handoff and `.cx/intake/processed/` but legacy `.cx/inbox/` and `docs/intake/` watch zones are mentioned as removed — are they truly gone or deprecated with a migration path?
- ADR-0046 mentions ~100 call sites of `specialists/unified-registry.json` — have these been migrated to use `loadRegistry()/assembleRegistry()`, or does the monolith still exist as a fallback?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Update ADR status (0018, 0019, 0020, 0021 proposed → accepted) via a single housekeeping bead to reflect ground truth
- Audit and fix ADR-0043 oracle CLI surface registration (move from internal:true to core:true or surface:thin-cli) to align with ADR-0039 amendment intent
- Validate ADR-0045 docs taxonomy enforcement: add ratchet checks to scripts/audit/ and construct doctor to detect and flag out-of-taxonomy files
- Document ADR-0046 modular org migration path: add construct migrate command or doctor lane to guide legacy unified-registry.json readers toward assembleRegistry() loader

