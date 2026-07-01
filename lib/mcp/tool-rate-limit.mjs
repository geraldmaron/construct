/**
 * lib/mcp/tool-rate-limit.mjs — per-tool call-rate budget for the MCP CallTool path.
 *
 * Solo deployment mode never instantiates lib/mcp/broker.mjs's Broker (that class
 * is role/policy-based and only wired in for team/enterprise), so the live MCP
 * dispatch path has no bound on how often a single tool can be called — a stuck
 * loop or an injected instruction can hammer a destructive tool until it exhausts
 * its approval tokens, or burn cost/tokens spamming a read tool. checkToolRateLimit
 * applies a sliding-window budget tiered by safety class, independent of role.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BUDGET_BY_CLASS = Object.freeze({
  destructive: 5,
  write: 60,
  read: 300,
});

export class ToolRateLimited extends Error {
  constructor(tool, budget, windowMs) {
    super(`rate-limited: ${tool} exceeded ${budget} calls per ${Math.round(windowMs / 1000)}s`);
    this.name = 'ToolRateLimited';
    this.tool = tool;
  }
}

export class ToolRateLimiter {
  constructor({ budgetByClass = DEFAULT_BUDGET_BY_CLASS, windowMs = DEFAULT_WINDOW_MS, now = () => Date.now() } = {}) {
    this.budgetByClass = budgetByClass;
    this.windowMs = windowMs;
    this.now = now;
    this.calls = new Map();
  }

  // Disabled when windowMs is falsy (0/NaN), mirroring the existing
  // CONSTRUCT_MCP_TOOL_TIMEOUT_MS override convention in lib/mcp/server.mjs.

  check(tool, safetyClass) {
    if (!this.windowMs) return;
    const budget = this.budgetByClass[safetyClass] ?? this.budgetByClass.read;
    const ts = this.now();
    const fresh = (this.calls.get(tool) || []).filter((t) => ts - t < this.windowMs);
    if (fresh.length >= budget) throw new ToolRateLimited(tool, budget, this.windowMs);
    fresh.push(ts);
    this.calls.set(tool, fresh);
  }
}
