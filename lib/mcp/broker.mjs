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

import fs from 'node:fs';
import path from 'node:path';
import { policyDecision } from '../policy/engine.mjs';
import { emitTraceEvent } from '../worker/trace.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';

const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_BUDGET = 30;

/**
 * BrokerStore — file-backed durable storage for broker rate-limit state.
 *
 * Persists call timestamps to `<rootDir>/.cx/broker-state.json` so that
 * rate-limit windows survive broker instance recreation and server restarts.
 * In-memory `_data` is the authoritative write buffer; `load`/`save` sync
 * against disk. All disk I/O is best-effort: a disk failure leaves in-memory
 * state intact without crashing the broker.
 * Rate-limit windows are keyed by actor+tool+windowStart (epoch ms).
 */
export class BrokerStore {
  constructor() {
    // key → timestamp[] (ms since epoch), trimmed to current window on read
    this._data = {};
  }

  /** Load persisted state from `storePath`. No-op if the file is absent or unreadable. */
  load(storePath) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this._data = parsed;
      }
    } catch { /* absent or corrupt file — start fresh */ }
  }

  /** Persist current state to `storePath`. Best-effort. */
  save(storePath) {
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(this._data), 'utf8');
    } catch { /* best-effort */ }
  }

  /**
   * getRateLimitState(actor, tool, windowMs) → timestamps[] within the window.
   * Trims stale entries before returning.
   */
  getRateLimitState(actor, tool, windowMs) {
    const key = `${actor}::${tool}`;
    const now = Date.now();
    const all = this._data[key] || [];
    const fresh = all.filter((ts) => now - ts < windowMs);
    this._data[key] = fresh;
    return fresh;
  }

  /**
   * incrementRateLimitState(actor, tool, windowMs) → updated timestamps[].
   * Appends `Date.now()` and trims stale entries.
   */
  incrementRateLimitState(actor, tool, windowMs) {
    const key = `${actor}::${tool}`;
    const now = Date.now();
    const all = this._data[key] || [];
    const fresh = all.filter((ts) => now - ts < windowMs);
    fresh.push(now);
    this._data[key] = fresh;
    return fresh;
  }
}

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
    store,
    approvalQueue,
  } = {}) {
    if (!rootDir) throw new Error('Broker: rootDir is required');
    this.rootDir = rootDir;
    this.policy = policy;
    this.emit = emit;
    this.rateBudget = rateBudget;
    this.rateWindowMs = rateWindowMs;
    this.now = now;
    // Durable store for rate-limit state.
    this._storePath = path.join(rootDir, '.cx', 'broker-state.json');
    this._store = store instanceof BrokerStore ? store : new BrokerStore();
    if (!(store instanceof BrokerStore)) {
      this._store.load(this._storePath);
    }
    // Approval queue for durable awaiting_approval state (per ADR-0056).
    this.approvalQueue = approvalQueue || null;
    // Keep this.calls as an in-memory Map for callers that read it directly
    this.calls = new Map();
  }

  /**
   * Attach an ApprovalQueue instance to this broker after construction.
   */
  setApprovalQueue(queue) {
    this.approvalQueue = queue;
  }

  _checkRate(role, tool) {
    const fresh = this._store.getRateLimitState(role, tool, this.rateWindowMs);
    if (fresh.length >= this.rateBudget) throw new RateLimited(role, tool, this.rateBudget);
    this._store.incrementRateLimitState(role, tool, this.rateWindowMs);
    // Persist after every update so the state is durable across restarts.
    this._store.save(this._storePath);
    // Keep the legacy Map in sync for any callers inspecting it directly.
    this.calls.set(`${role}::${tool}`, this._store.getRateLimitState(role, tool, this.rateWindowMs));
  }

  /**
   * Invoke a tool through the broker. The `execute` function does the
   * actual work; the broker decides whether to call it.
   *
   * When approval is required, returns a structured `{ status, approvalId,
   * resumeToken, expiresAt }` instead of throwing. Callers that retry with
   * the same tool+args will match the existing approval record. After the
   * record is approved (via CLI or API), a call with the same args executes
   * the tool. Pass `resumeToken` explicitly to bypass argsHash dedup.
   *
   * @param {object} args
   * @param {string} args.role
   * @param {string} args.tool
   * @param {string} args.action
   * @param {object} [args.toolArgs]  - Raw tool arguments for argsHash dedup
   * @param {string} [args.risk]
   * @param {string} [args.project]
   * @param {string} [args.traceId]
   * @param {string} [args.resumeToken] - Explicit resume token (bypasses dedup)
   * @param {object} [args.requestedBy] - Actor identity
   * @param {Function} args.execute
   * @returns {Promise<{result, decision}|{status, approvalId, resumeToken, expiresAt}>}
   */
  async invoke({ role, tool, action, toolArgs, risk, project, traceId, resumeToken, requestedBy, execute }) {
    if (typeof execute !== 'function') throw new Error('Broker.invoke: execute function is required');

    // If a resumeToken is provided, look up the approval record directly.
    if (resumeToken && this.approvalQueue) {
      const record = this.approvalQueue.getByResumeToken(resumeToken);
      if (!record) return { status: 'not_found', resumeToken };
      if (record.state === 'approved') {
        const result = await execute();
        return { result, decision: { allowed: true, reason: 'resumed after approval', approvalRequired: false, source: 'approval-queue' } };
      }
      if (record.state === 'denied') return { status: 'denied', approvalId: record.approvalId, reason: record.reason };
      if (record.state === 'expired') return { status: 'expired', approvalId: record.approvalId };
      return { status: 'awaiting_approval', approvalId: record.approvalId, resumeToken: record.resumeToken, expiresAt: record.expiresAt };
    }

    // Compute argsHash for dedup with the approval queue.
    const argsHash = this.approvalQueue ? ApprovalQueue.hashToolCall(tool, toolArgs ?? {}) : null;

    // Check if there is already an approval record for this exact tool call.
    if (this.approvalQueue && argsHash) {
      this.approvalQueue.expireStale();
      const existing = this.approvalQueue.findByToolArgs(tool, argsHash);
      if (existing) {
        if (existing.state === 'approved') {
          const result = await execute();
          return { result, decision: { allowed: true, reason: 'approved via queue', approvalRequired: false, source: 'approval-queue' } };
        }
        if (existing.state === 'denied') return { status: 'denied', approvalId: existing.approvalId, reason: existing.reason };
        if (existing.state === 'expired') return { status: 'expired', approvalId: existing.approvalId };
        return { status: 'awaiting_approval', approvalId: existing.approvalId, resumeToken: existing.resumeToken, expiresAt: existing.expiresAt };
      }
    }

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

    if (decision.approvalRequired) {
      if (this.approvalQueue) {
        const record = this.approvalQueue.enqueue({
          tool,
          args: toolArgs ?? {},
          surface: 'mcp',
          argsHash,
          requestedBy: requestedBy ?? { role },
        });
        return {
          status: 'awaiting_approval',
          approvalId: record.approvalId,
          resumeToken: record.resumeToken,
          expiresAt: record.expiresAt,
        };
      }
      // No queue configured — fall back to throwing for backward compat.
      throw new ApprovalRequired(decision);
    }

    this._checkRate(role, tool);
    const result = await execute();
    return { result, decision };
  }
}

export function isBrokered(env = process.env, { cwd } = {}) {
  const override = env?.CONSTRUCT_MCP_BROKER;
  if (override === 'on') return true;
  if (override === 'off') return false;
  const mode = getDeploymentMode(env, { cwd });
  return mode === 'team' || mode === 'enterprise';
}
