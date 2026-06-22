/**
 * lib/mcp/tool-budget.mjs — tool-surface sizing for the OpenCode integration.
 *
 * OpenCode 1.15.4 exposes no per-session tool filter (chat.params carries only
 * sampler params, and tool.definition cannot remove a tool or see the model), so
 * the serialized tool surface is fixed by two config/server-time levers:
 *   1. construct-mcp's ListTools — a lean core + the construct_call gateway.
 *   2. which external MCP servers are `enabled` in opencode.json — sync disables
 *      the heavy ones for local-capable setups (they cannot be trimmed at runtime).
 * Holds the shared token-sizing helper and the external-server id list both
 * levers reason about, plus the owned-loop tool-budget filter that trims the
 * Vercel AI SDK tool set to a compiled execution policy's allowed groups and
 * schema cap (lib/models/execution-policy.mjs).
 */

import { getMeasuredHeavyExternalMcpTokenCost } from './external-schema-cost.mjs';

const TOKENS_PER_CHAR = 0.25;

// Heavy external MCP servers Construct registers globally. On a local-capable
// setup these serialize a measured ~37k tokens of tool schema into every agent's
// window (github alone ~30k as of 2026-06-22; see tests/fixtures/mcp-tool-schemas/
// and scripts/measure-external-mcp-schemas.mjs) and cannot be filtered per request,
// so sync disables them in opencode.json. construct-mcp's own knowledge_search /
// memory_search cover the search/memory cases.

export const HEAVY_EXTERNAL_MCP_IDS = ['context7', 'github', 'memory', 'sequential-thinking', 'playwright'];

export const LOCAL_SURFACE_MODES = ['auto', 'on', 'off'];

// A model benefits from trimming only when it is a small-context local runtime
// reached over Ollama/localhost. github-copilot is a hosted, full-context proxy,
// so it is deliberately not "local" here even though it is provider-local.

export function isLocalModel(model) {
  const m = (model || "").toLowerCase();
  if (m.startsWith("local/")) return true;
  return m.includes("ollama") || m.includes("localhost") || m.includes("127.0.0.1");
}

// Decide whether to disable the heavy external MCP servers for one opencode.json.
// Trimming is driven by INTENT — the default model this config actually selects —
// not by whether the machine happens to have Ollama installed. Machine-wide
// presence stripped context7/github from cloud sessions that merely shared a box
// with Ollama; keying off the config's own default model preserves cloud surfaces
// and still shrinks the window when the user has chosen a local model.
//   surface: 'on' (always trim) | 'off' (never) | 'auto' (trim iff default is local)

export function decideTrim({ surface = 'auto', defaultModel = null } = {}) {
  if (surface === 'off') return false;
  if (surface === 'on') return true;
  return isLocalModel(defaultModel);
}

export function estimateToolTokens(tools) {
  if (!tools) return 0;
  const arr = Array.isArray(tools) ? tools : Object.values(tools);
  return Math.round(JSON.stringify(arr).length * TOKENS_PER_CHAR);
}

export { getMeasuredHeavyExternalMcpTokenCost };

// Maps the owned loop's agent tool names (apps/chat/engine/tools/registry.mjs)
// onto the execution-policy tool groups (lib/models/execution-policy.mjs) so a
// compiled policy can trim the serialized tool surface for a capability-
// constrained model. construct_tool is the single MCP gateway, so it stands in
// for the whole 'construct' group. An unrecognized name falls back to
// 'construct' — a group present in every tier — so an unclassified tool is never
// silently dropped from a constrained surface.

const AGENT_TOOL_GROUPS = Object.freeze({
  read: 'read',
  glob: 'search',
  grep: 'search',
  write: 'edit',
  edit: 'edit',
  shell: 'shell',
  construct_tool: 'construct',
});

export function toolGroupForName(name) {
  return AGENT_TOOL_GROUPS[name] || 'construct';
}

// Trim a tool set to the compiled policy's envelope: drop any tool whose group is
// outside allowedToolGroups, then cap the survivors at maxToolSchemas in stable
// insertion order. A null allowedToolGroups means "no group filter" and an
// unbounded cap means "no count limit", so the rich/hosted-direct envelope (all
// groups, cap 32) returns the input set unchanged.

export function applyToolBudget(tools, { allowedToolGroups = null, maxToolSchemas = Infinity } = {}) {
  if (!tools || typeof tools !== 'object') return tools;
  const allow = Array.isArray(allowedToolGroups) ? new Set(allowedToolGroups) : null;
  const cap = Number.isFinite(maxToolSchemas) ? Math.max(0, Math.floor(maxToolSchemas)) : Infinity;
  const out = {};
  let kept = 0;
  for (const [name, def] of Object.entries(tools)) {
    if (allow && !allow.has(toolGroupForName(name))) continue;
    if (kept >= cap) break;
    out[name] = def;
    kept += 1;
  }
  return out;
}
