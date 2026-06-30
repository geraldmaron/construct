---
intake: none
---

# Registry Extraction Inventory — architecture-gate

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Bead: `construct-rr63.2.1`
Opens the architecture-gate (risk R3) for the Wave-3 registry-first extraction. Companion golden
test: `tests/registry-characterization.test.mjs`. **No extraction is performed in this bead** — this
inventory + the golden snapshot of current values is the safety net a later extraction uses to prove
zero behaviour change.

## Provenance

Each location below was re-opened and confirmed by Opus (file:line + current value). Agent B's report
seeded the leads; two of its citations were corrected here (see Adjudications).

## Hardcoded lists — extraction candidates

| # | Target | Verified location | Exported? | Current value (summary) | Extraction proposal | Characterized by |
|---|---|---|---|---|---|---|
| 1 | MCP **core tool set** + full catalog | `lib/mcp/server.mjs:1323` (`CORE_TOOL_NAMES`), `lib/mcp/server.mjs:131` (`ALL_TOOL_DEFS`) | no | flat-exposure core subset + full tool catalog (`LONG_TAIL_DEFS` is the complement) | `registry/mcp-tools.json` (+ `outputSchema`/`errorSchema`/`read_only`) | `tests/functional/mcp-core-tools.functional.test.mjs` (canonical core set) |
| 2 | **Selectable services** | `lib/service-manager.mjs:276` (`SELECTABLE_SERVICES`, frozen) | yes | `telemetry`, `memory`, `opencode`, `copilot-bridge` | `construct.config` `services.available` | **this test (golden)** |
| 3 | **Runtime ports** | `lib/service-manager.mjs:254-255` (defaults), `:492`, `:496` (fallbacks) | via `getRuntimePorts()` | bridge `5173`, copilot-bridge `5174` | config `services.ports` | inventory-only (live-probed; not golden-tested to avoid env flakiness) |
| 4 | **Doc lanes** | `lib/init/doc-lanes.mjs:8` (`DOC_LANES`), `:85` (`LANE_ORDER`), `:87` (`DOC_PRESETS`), `:93` (`DEFAULT_LANES`), `:95` (`LANE_ALIASES`) | yes | 11 lanes; presets lean/product/full; 28 alias keys | `registry/doc-lanes.json` | **this test (golden + alias-collision pin)** |
| 5 | **OpenCode builtin agents** | `lib/parity.mjs:185` (`OPENCODE_BUILTIN_AGENTS`) | no | `title`, `summary`, `compaction` | `registry/editor-defaults.json` keyed by surface | needs export first (Wave-3 prerequisite) |
| 6 | **VS Code MCP config paths** | `lib/parity.mjs:148` **and** `lib/features.mjs:67` (`getVSCodeUserMcpPaths`, duplicated) | no | per-OS `…/Code/User/mcp.json` (+ Insiders) | `lib/surfaces/config-paths.mjs` single source | needs consolidation (Wave 3) |
| 7 | **Legacy version boundaries** | `lib/parity.mjs` (`reclassifyLegacy` + `legacyUserScopeRoster`; `v1.0.10`/`v1.0.13` literals) | no | hardcoded version strings | declarative version-migration table | inventory-only |

## Adjudications (Opus vs Agent B)

- **Refuted:** Agent B reported VS Code MCP paths duplicated across `parity.mjs`, `features.mjs`, **and
  `mcp-manager.mjs`**. `lib/mcp/mcp-manager.mjs` **does not exist** in the tree. Verified duplication is
  `parity.mjs:148` + `features.mjs:67` only (row 6).
- **Confirmed:** `SELECTABLE_SERVICES`, `DOC_LANES`/`LANE_ORDER`/`DOC_PRESETS`/`LANE_ALIASES`,
  `CORE_TOOL_NAMES`/`ALL_TOOL_DEFS`, `OPENCODE_BUILTIN_AGENTS`, and the `5173/5174` ports are all
  present at the cited lines.

## What the golden test pins (so extraction proves zero behaviour change)

`tests/registry-characterization.test.mjs` snapshots the **exported** extraction targets (rows 2 and
4) at their exact current values, plus the invariant that every doc-lane alias resolves to a real lane
and the specific alias-collision Agent H flagged (`incident`/`incidents` → `postmortems`). When a
Wave-3 PR moves these values into a registry, it re-points the import source and the snapshots must
stay byte-identical — any drift fails the test.

Rows 1, 3, 5, 6, 7 are **not** golden-snapshotted here: row 1 is already covered by the MCP core-tools
functional test; row 3 is live-probed; rows 5–7 require the symbol to be exported / consolidated first,
which is the first step of their Wave-3 extraction.

## Gate status

This inventory + golden test open the architecture-gate. The Wave-3 extraction beads (per-registry
extraction, generate docs from registry) are authored only after this gate is green.
