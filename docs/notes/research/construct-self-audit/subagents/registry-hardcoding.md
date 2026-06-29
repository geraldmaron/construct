---
intake: none
---

# Subagent Evidence Report: Registry and hardcoding audit

> Agent B · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct exhibits deliberate data-driven architecture for doc lanes, capabilities, and specialists via registry/loader, yet retains hardcoded lists for runtime services, MCP tool exposure, platform paths, and migration behavior. Core MCP tools (15-item set) are frozen in code; platform-specific paths for VS Code, Cursor, OpenCode are replicated across three files; legacy migration logic references v1.0.10 and v1.0.13 by version string; and intake detection uses hand-curated directory/script candidates. Service ports (5173, 5174) and OpenCode built-ins ('title', 'summary', 'compaction') are hardcoded. The project-config schema enumerates allowed values (profiles, deployment modes), but runtime behavior around these enum choices lives scattered across init, sync, and parity modules.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Core MCP tool set is hardcoded as frozen array | `lib/mcp/server.mjs:1323-1328` — const CORE_TOOL_NAMES = new Set(['orchestration_policy', 'get_skill', 'get_template', 'search_skills', 'knowledge_search', 'memory_search', 'project_context', 'summarize_diff', 'find_tool', 'author_artifact', 'document_export', 'publish_run', 'artifact_workflow', 'workflow_invoke', 'triage_recommend', 'orchestration_readiness']). This 15-tool list determines which tools bypass the construct_call meta-gateway and appear flat to every host/model. | confirmed |
| Hardcoded service port defaults in runtime port resolution | `lib/service-manager.mjs:254-255` — bridge: await resolvePort('BRIDGE_PORT', 5173, openCodeProbeFn), copilotBridge: await resolvePort('COPILOT_BRIDGE_PORT', 5174, probeRuntimePort). Also hardcoded fallbacks at lines 492 and 496: const bridgePort = Number(envValues.BRIDGE_PORT) \|\| 5173; const copilotBridgePort = Number(envValues.COPILOT_BRIDGE_PORT) \|\| 5174. | confirmed |
| SELECTABLE_SERVICES hardcoded as frozen list | `lib/service-manager.mjs:276-281` — export const SELECTABLE_SERVICES = Object.freeze([ { key: 'telemetry', label: 'Telemetry', description: '...' }, { key: 'memory', label: 'Memory (cm)', description: '...' }, { key: 'opencode', label: 'OpenCode', description: '...' }, { key: 'copilot-bridge', label: 'Copilot Bridge', description: '...' }]). This list governs which services construct dev can start. | confirmed |
| OpenCode builtin agents list hardcoded | `lib/parity.mjs:185` — const OPENCODE_BUILTIN_AGENTS = new Set(['title', 'summary', 'compaction']). Used to filter system agents from managed agent parity checks, hardwired to OpenCode's own system agent names. | confirmed |
| VS Code user config paths hardcoded with platform branching | `lib/parity.mjs:148-170` — function getVSCodeUserMcpPaths(homeDir) { const platform = os.platform(); if (platform === 'darwin') return [path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'), ...]; if (platform === 'linux') return [path.join(homeDir, '.config', 'Code', 'User', 'mcp.json'), ...]; if (platform === 'win32') { const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'); return [path.join(appData, 'Code', 'User', 'mcp.json'), ...]; }}. Duplicated in lib/features.mjs:67-91 and lib/mcp-manager.mjs:41-63. | confirmed |
| Doc lane directory aliases and order hardcoded in code | `lib/init/doc-lanes.mjs:8-91` — export const DOC_LANES = { adrs: {...}, briefs: {...}, ... } with 11 lane definitions. export const LANE_ORDER = ['adrs', 'briefs', 'changelogs', 'memos', 'meetings', 'notes', 'onboarding', 'postmortems', 'prds', 'rfcs', 'runbooks']. export const DOC_PRESETS = { lean: ['adrs', 'memos', 'meetings', 'notes', 'prds'], product: [...], full: LANE_ORDER }. Also duplicated in lib/init/detect-existing-structure.mjs:33-65 as LANE_DIR_ALIASES. | confirmed |
| Intake script and path candidate lists hardcoded | `lib/init/detect-existing-structure.mjs:99-112` — const INTAKE_SCRIPT_CANDIDATES = ['ingest', 'ingest.sh', 'ingest.mjs', 'ingest.js', 'ingest.py']. const INTAKE_PATH_CANDIDATES = ['data/customers/notes/raw', 'data/intake', 'data/raw', 'ingestion', 'intake-pipeline', 'raw']. These heuristically detect existing project intake structure, but the candidates list must be updated in code if new patterns emerge. | confirmed |
| Directory scan skip list is hardcoded | `lib/init/detect-existing-structure.mjs:70-92` — const SCAN_SKIP_DIRS = new Set(['.git', '.cx', '.beads', '.construct', '.claude', '.codex', '.cursor', '.vscode', '.github', '.husky', 'node_modules', 'dist', 'build', 'coverage', 'target', '.next', '.cache', '.pnpm-store', '.venv', 'venv', '__pycache__']). Determines which directories are excluded from lane detection when init scans for existing content. | confirmed |
| Legacy v1.0.10 migration roster computed at runtime from registry | `lib/parity.mjs:406-413` — function legacyUserScopeRoster(registry) { const prefix = registry.prefix \|\| 'cx'; const specialists = Object.values(registry.specialists \|\| {}).map((s) => `${prefix}-${s.name}`); const frontDoor = registry.orchestrator?.name ? [registry.orchestrator.name] : []; return new Set([...specialists, ...frontDoor]); }. Hardcodes the logic that v1.0.10 populated cx-* specialists at user scope; reclassification logic at line 455 uses this to suppress 'drift' for known-legacy patterns. | confirmed |
| Heavy external MCP server IDs list hardcoded | `lib/mcp/tool-budget.mjs:25` — export const HEAVY_EXTERNAL_MCP_IDS = ['context7', 'github', 'memory', 'sequential-thinking', 'playwright']. This list controls which MCP servers are disabled when local models are configured, to reduce token overhead. | confirmed |
| Project .cx directory structure hardcoded across init | `lib/service-manager.mjs:81-82` — beads: fs.existsSync(path.join(rootDir, '.beads', 'metadata.json')) ? '.beads/metadata.json' : null, and paths like '.cx/context.md', '.cx/traces' are assumed throughout. Platform-agnostic but directory name itself is hardcoded; no config-driven alternative structure supported. | confirmed |
| ALL_TOOL_DEFS array in MCP server hardcodes full tool catalog | `lib/mcp/server.mjs:131-1320` — const ALL_TOOL_DEFS = [...large array...] defines every MCP tool schema inline (71 tools). Tools are not loaded from registry or data file; the array is defined line-by-line in code, making additions/removals require code edits. | confirmed |
| Project-scoped adapter paths hardcoded in parity checks | `lib/parity.mjs:373-385` — checkProjectMcp(registry, { projectDir, surface: 'cursor', relPath: '.cursor/mcp.json', configKey: 'mcpServers' }), checkProjectMcp(registry, { projectDir, surface: 'vscode', relPath: '.vscode/mcp.json', configKey: 'servers' }), checkProjectCursorRules({ projectDir }) checks path: path.join(projectDir, '.cursor', 'rules', 'construct.mdc'). Relative paths are frozen; no config-driven alternative locations. | confirmed |
| Version-specific migration hints reference v1.0.10 and v1.0.13 | `lib/parity.mjs:420-425` — Comment: 'dev box mid-upgrade from v1.0.10 (which populated cx-* specialists at user scope) to v1.0.13+ (project scope only)'. Upgrade path is hardwired to these specific version boundaries; no version-agnostic migration contract defined. | confirmed |

## 3. Confirmed gaps

- Core MCP tool exposure list (15 tools) lacks a data-driven registry; additions require editing lib/mcp/server.mjs and manually curating CORE_TOOL_NAMES set.
- ALL_TOOL_DEFS array (71 tools) is defined inline in code rather than loaded from registry or manifest; tool catalog changes require code edits.
- Platform-specific MCP path resolution (VS Code, Cursor, OpenCode) duplicated across three files (parity.mjs, features.mjs, mcp-manager.mjs) with no single source of truth.
- Service ports (5173, 5174) and fallback logic hardcoded in service-manager.mjs; environment-driven overrides via config file not supported.
- Legacy migration version boundaries (v1.0.10, v1.0.13) embedded in parity.mjs; no version metadata store or dynamic upgrade path detection.
- Intake script/path detection uses hardcoded candidate lists in detect-existing-structure.mjs; new patterns require code changes.
- OpenCode builtin agent names ('title', 'summary', 'compaction') hardcoded in parity.mjs with no external registry reference.
- SELECTABLE_SERVICES list in service-manager.mjs frozen in code; no config-driven service registry.

## 4. Unconfirmed concerns

- No evidence that registry/capabilities.json is actually consumed by init or service-manager; file appears to be metadata/documentation only, not runtime config.
- Unclear whether project-config.schema.json enum choices (profiles, deployment.mode) are validated at load time or are advisory only.
- Platform path detection in parity.mjs, features.mjs, mcp-manager.mjs may have drift if files are edited independently; no integration test verifies all three produce identical paths for the same platform.
- LANE_ORDER array duplication in two files (doc-lanes.mjs and detect-existing-structure.mjs as LANE_DIR_ALIASES) suggests potential for inconsistency if only one is updated during a refactor.

## 5. Registry / config / schema opportunities

- Move CORE_TOOL_NAMES and ALL_TOOL_DEFS into registry/capabilities.json or a dedicated lib/mcp/tools-manifest.json; allow tooling to auto-generate or merge definitions.
- Create a surfaces manifest (surfaces.json or similar) to centralize platform-specific MCP config paths, replacing duplicate getVSCodeUserMcpPaths implementations.
- Extract service configurations (telemetry, memory, opencode, copilot-bridge) into construct.config.json schema under a services.selectable key, replacing SELECTABLE_SERVICES hardcode.
- Move HEAVY_EXTERNAL_MCP_IDS to registry/mcp-servers.json or capabilities.json under a metadata.budget section; allow per-server token-cost annotations.
- Consolidate doc-lane definitions (DOC_LANES, LANE_ORDER, DOC_PRESETS) into registry/ and load at runtime; remove duplicate LANE_DIR_ALIASES from detect-existing-structure.mjs.
- Replace version-specific migration logic (v1.0.10/v1.0.13) with a versioned upgrade path table; store in registry or separate .cx/migration-history.json.
- Extract OpenCode builtin agent roster and other editor-specific constants into registry/editor-defaults.json keyed by surface name.
- Move intake script and path candidates into project-config.schema.json under ingestPolicy.knownScriptNames and knownPathPatterns; allow project-level overrides.

## 6. Tests needed

- Verify ALL_TOOL_DEFS length and CORE_TOOL_NAMES membership; confirm no tool appears in both CORE_TOOL_NAMES and LONG_TAIL_DEFS.
- Cross-platform path test: confirm getVSCodeUserMcpPaths(homeDir) produces identical paths across lib/parity.mjs, lib/features.mjs, lib/mcp-manager.mjs for darwin, linux, win32.
- Verify registry loader does not regress when specialists or capabilities are added; test that changes to specialists/org trigger cache invalidation.
- Intake detection: confirm INTAKE_SCRIPT_CANDIDATES and INTAKE_PATH_CANDIDATES match real project layouts in the test suite.
- Legacy migration: confirm reclassifyLegacy logic correctly identifies v1.0.10 user-scope agents; test that upgrade path guidance is displayed.

## 7. Docs needed

- ADR or contract documenting the contract between CORE_TOOL_NAMES and exposedTools(); specify when/how to add a tool to core vs. long-tail.
- Manifest schema for MCP tool definitions (ALL_TOOL_DEFS); specify tool metadata, versioning, and deprecation paths.
- Surface manifest schema for platform-specific paths, builtin agents, and MCP config file locations; centralize editor assumptions.
- Migration guide: document v1.0.10→v1.0.13+ upgrade path; specify version boundaries and reclassification rules for future upgrades.
- Project-config.schema.json: add examples and prose for enum values (profiles: rnd/operations/creative/research; deployment.mode: solo/team/enterprise).
- Intake policy specification: document heuristics for script/path detection; allow projects to register custom candidates via project-config.json.

## 8. Migration concerns

- Moving ALL_TOOL_DEFS to data file requires runtime tool schema loading in lib/mcp/server.mjs; validate that tool definitions are valid before exposing to hosts.
- Platform path consolidation in features.mjs and mcp-manager.mjs may have subtle callers expecting specific directory structures; refactor must preserve behavior.
- Elevating CORE_TOOL_NAMES to a registry value requires careful rollout: models trained on the old hard-coded list may hallucinate long-tail tools; may need versioning.
- LANE_ORDER appears as LANE_DIR_ALIASES in detect-existing-structure.mjs: consolidation must verify all call sites reference the canonical definition.
- Version-specific migration logic removal (v1.0.10/v1.0.13) is a breaking change for users on very old installs; needs careful upgrade sequencing.

## 9. Questions for Opus

- Is registry/capabilities.json intended to be runtime config that populates the MCP tool list, or is it purely documentation/metadata?
- Should project-config.schema.json enum choices (profiles, deployment.mode) have corresponding runtime branching logic in init and service-manager, or are they informational only?
- Is there an existing contract or ADR documenting when a tool should be CORE (flat exposure) vs. long-tail (behind construct_call)?
- Should intake detection support custom script/path candidates via project-config.json, or is the hardcoded list intentionally minimal?
- How should doc-lane definitions be versioned if a future profile adds or removes lanes?
- Is the v1.0.10→v1.0.13 migration path a one-time event, or should parity.mjs support multiple migration windows for future version boundaries?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Extract CORE_TOOL_NAMES and ALL_TOOL_DEFS into lib/mcp/tools-manifest.mjs or registry/mcp-tools.json
- Consolidate platform MCP paths into lib/surfaces/config-paths.mjs with platform-parametric getConfigPaths(platform, homeDir)
- Move SELECTABLE_SERVICES to construct.config.schema.json under services.available with per-service metadata
- Refactor legacy migration logic in parity.mjs into lib/upgrade/v1-to-v2.mjs with version-table-driven classification
- Create lib/intake/candidates.mjs to export INTAKE_SCRIPT_CANDIDATES and INTAKE_PATH_CANDIDATES; document extensibility via project-config
- Consolidate doc-lanes definitions into registry/doc-lanes.json and load at runtime

