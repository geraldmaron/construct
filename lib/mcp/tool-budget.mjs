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
 * levers reason about.
 */

const TOKENS_PER_CHAR = 0.25;

// Heavy external MCP servers Construct registers globally. On a local-capable
// setup these alone serialize ~12k tokens into every agent's window (including
// the built-in Build/Plan agents) and cannot be filtered per request, so sync
// disables them in opencode.json. construct-mcp's own knowledge_search /
// memory_search cover the search/memory cases.

export const HEAVY_EXTERNAL_MCP_IDS = ['context7', 'github', 'memory', 'sequential-thinking', 'playwright'];

export function estimateToolTokens(tools) {
  if (!tools) return 0;
  const arr = Array.isArray(tools) ? tools : Object.values(tools);
  return Math.round(JSON.stringify(arr).length * TOKENS_PER_CHAR);
}
