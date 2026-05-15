/**
 * lib/mcp/broker.mjs — role-based MCP broker.
 *
 * Wraps tool invocations with a policy check, an audit-trail event, and
 * an optional rate limit. In solo mode the broker is off by default so
 * tool calls run direct. In team / enterprise mode the deployment-mode
 * resolver wires the broker in, every tool call traverses
 * `Broker.invoke({...})`, every denial emits a typed error rather than
 * a silent fallthrough, and every brokered call appends a `tool.called`
 * trace event tagged with the policy decision.
 */

import { policyDecision } from '../policy/engine.mjs';
import { emitTraceEvent } from '../worker/trace.mjs';

const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_BUDGET = 30;

export class PolicyDenied extends Error {
  constructor(decision) {
    super(`policy denied: ${decision.reason}`);
    this.name = 'PolicyDenied';
    this.decision = decision;
  }
}

export class ApprovalRequired extends Error {
  constructor(decision) {
    super(`approval required: ${decision.reason}`);
    this.name = 'ApprovalRequired';
    this.decision = decision;
  }
}

export class RateLimited extends Error {
  constructor(role, tool, budget) {
    super(`rate-limited: role ${role} exceeded ${budget} ${tool} calls per window`);
    this.name = 'RateLimited';
    this.role = role;
    this.tool = tool;
  }
}

export class Broker {
  constructor({
    rootDir,
    policy = policyDecision,
    emit = emitTraceEvent,
    rateBudget = DEFAULT_RATE_BUDGET,
    rateWindowMs = DEFAULT_RATE_WINDOW_MS,
    now = () => Date.now(),
  } = {}) {
    if (!rootDir) throw new Error('Broker: rootDir is required');
    this.rootDir = rootDir;
    this.policy = policy;
    this.emit = emit;
    this.rateBudget = rateBudget;
    this.rateWindowMs = rateWindowMs;
    this.now = now;
    this.calls = new Map();
  }

  _checkRate(role, tool) {
    const key = `${role}::${tool}`;
    const ts = this.now();
    const window = this.calls.get(key) || [];
    const fresh = window.filter((t) => ts - t < this.rateWindowMs);
    if (fresh.length >= this.rateBudget) throw new RateLimited(role, tool, this.rateBudget);
    fresh.push(ts);
    this.calls.set(key, fresh);
  }

  /**
   * Invoke a tool through the broker. The `execute` function does the
   * actual work; the broker decides whether to call it.
   *
   * @param {object} args
   * @param {string} args.role
   * @param {string} args.tool
   * @param {string} args.action
   * @param {string} [args.risk]
   * @param {string} [args.project]
   * @param {string} [args.traceId]
   * @param {Function} args.execute
   * @returns {Promise<{result, decision}>}
   */
  async invoke({ role, tool, action, risk, project, traceId, execute }) {
    if (typeof execute !== 'function') throw new Error('Broker.invoke: execute function is required');

    const decision = this.policy({ role, project, tool, action, risk });

    this.emit({
      rootDir: this.rootDir,
      eventType: 'tool.called',
      traceId,
      project,
      role,
      metadata: {
        tool,
        action,
        risk: risk || 'low',
        allowed: decision.allowed,
        approvalRequired: decision.approvalRequired,
        reason: decision.reason,
        source: decision.source,
      },
    });

    if (!decision.allowed) throw new PolicyDenied(decision);
    if (decision.approvalRequired) throw new ApprovalRequired(decision);

    this._checkRate(role, tool);
    const result = await execute();
    return { result, decision };
  }
}

export function isBrokered(env = process.env) {
  const override = env?.CONSTRUCT_MCP_BROKER;
  if (override === 'on') return true;
  if (override === 'off') return false;
  const mode = env?.CONSTRUCT_DEPLOYMENT_MODE || 'solo';
  return mode === 'team' || mode === 'enterprise';
}
