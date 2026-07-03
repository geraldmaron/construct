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
 *
 * LMCP-I3: every decision (allow/deny/approval_required) is also recorded
 * as durable evidence under one schema — {decisionId, actor, tenant,
 * project, tool, target, risk, outcome, correlationId, ts} — via
 * `_recordDecision`. Denied decisions additionally persist to
 * lib/mcp/denied-store.mjs so a PolicyDenied throw is never the only trace
 * of the denial. `correlationId` reuses an inbound `traceId` when the
 * caller has one, or mints a fresh trace-shaped id, so the same value ties
 * the broker call to its `tool.called` trace event and to any run/task/
 * external write layered on top by the caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { policyDecision } from '../policy/engine.mjs';
import { emitTraceEvent, newTraceId } from '../worker/trace.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { resolveTenantContext } from '../tenant/context.mjs';
import { appendAuditRecord } from '../audit-trail.mjs';
import { DeniedStore } from './denied-store.mjs';

const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_BUDGET = 30;

// Every broker decision — allow, deny, or approval-required — is recorded
// under this one schema so the durable denied-store and the audit-trail
// entry for the same decision can be cross-referenced by decisionId, and a
// correlationId ties the decision back to the trace event and, downstream,
// to whatever run/task/external write the tool call was part of.

function newDecisionId() {
  return `decision-${crypto.randomBytes(8).toString('hex')}`;
}

function buildDecisionRecord({ decision, outcome, actor, tenant, project, tool, target, risk, correlationId, ts }) {
  return {
    decisionId: newDecisionId(),
    actor: actor ?? 'unknown',
    tenant: tenant ?? 'unknown',
    project: project ?? null,
    tool: tool ?? 'unknown',
    target: target ?? null,
    risk: risk || 'low',
    outcome,
    correlationId,
    reason: decision?.reason ?? null,
    source: decision?.source ?? null,
    ts,
  };
}

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
  constructor(decision, correlationId = null) {
    super(`policy denied: ${decision.reason}`);
    this.name = 'PolicyDenied';
    this.decision = decision;
    this.correlationId = correlationId;
  }
}

export class ApprovalRequired extends Error {
  constructor(decision, correlationId = null) {
    super(`approval required: ${decision.reason}`);
    this.name = 'ApprovalRequired';
    this.decision = decision;
    this.correlationId = correlationId;
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
    deniedStore,
    tenantContext,
    auditRecorder = appendAuditRecord,
    env = process.env,
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
    // Durable store for denied decisions (LMCP-I3) — every PolicyDenied
    // throw also lands a row here, keyed by decisionId, before the error
    // leaves invoke().
    this._deniedStore = deniedStore instanceof DeniedStore ? deniedStore : new DeniedStore({ rootDir });
    // Audit recorder is injectable so tests can capture records without
    // touching the real ~/.cx/audit-trail.jsonl file.
    this._auditRecorder = auditRecorder;
    // Tenant resolved once per broker instance (env/config are stable for
    // the process lifetime); reused for every decision record.
    this._tenant = tenantContext || resolveTenantContext({ env, mode: getDeploymentMode(env, { cwd: rootDir }) }).tenantId;
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

  // requestedBy already carries the H2 identity record (identityToRecord()
  // shape: userId/serviceId/role/...) at every call site observed in
  // lib/mcp/server.mjs and lib/writes/envelope.mjs. Fall back to role, then
  // to 'unknown' rather than fabricating an identity that was never resolved.

  _resolveActor(role, requestedBy) {
    if (requestedBy && typeof requestedBy === 'object') {
      const id = requestedBy.userId || requestedBy.serviceId;
      if (id) return id;
    }
    return role || 'unknown';
  }

  /**
   * Record a broker decision as durable evidence: a denied-store row when
   * the outcome is 'denied', and an audit-trail entry for every outcome
   * (allow/deny/approval) under the same schema. Both writes are
   * best-effort — a disk failure here must never break tool dispatch, the
   * same guarantee lib/mcp/server.mjs already gives its own audit call.
   */
  _recordDecision({ decision, outcome, role, tool, action, risk, project, requestedBy, correlationId }) {
    const record = buildDecisionRecord({
      decision,
      outcome,
      actor: this._resolveActor(role, requestedBy),
      tenant: this._tenant,
      project,
      tool,
      target: action ?? null,
      risk,
      correlationId,
      ts: new Date(this.now()).toISOString(),
    });

    if (outcome === 'denied') {
      try { this._deniedStore.append(record); } catch { /* best-effort, mirrors BrokerStore.save */ }
    }

    try { this._auditRecorder({ agent: 'mcp-broker', ...record }); } catch { /* audit trail unavailable must not fail the call */ }

    return record;
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
   * @param {object} [args.requestedBy] - Actor identity (identityToRecord() shape)
   * @param {Function} args.execute
   * @returns {Promise<{result, decision, correlationId}|{status, approvalId, resumeToken, expiresAt, correlationId}>}
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

    // correlationId ties this broker decision to the tool.called trace event
    // (same value as traceId), and downstream to whatever run/task/external
    // write the caller layers on top — reuse an inbound traceId so a caller
    // that already has one keeps a single id across the whole chain, and
    // mint a trace-shaped id only when the caller supplied none.

    const correlationId = traceId || newTraceId();

    this.emit({
      rootDir: this.rootDir,
      eventType: 'tool.called',
      traceId: correlationId,
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

    if (!decision.allowed) {
      this._recordDecision({ decision, outcome: 'denied', role, tool, action, risk, project, requestedBy, correlationId });
      throw new PolicyDenied(decision, correlationId);
    }

    if (decision.approvalRequired) {
      this._recordDecision({ decision, outcome: 'approval_required', role, tool, action, risk, project, requestedBy, correlationId });
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
          correlationId,
        };
      }
      // No queue configured — fall back to throwing for backward compat.
      throw new ApprovalRequired(decision, correlationId);
    }

    this._recordDecision({ decision, outcome: 'allowed', role, tool, action, risk, project, requestedBy, correlationId });
    this._checkRate(role, tool);
    const result = await execute();
    return { result, decision, correlationId };
  }
}

export function isBrokered(env = process.env, { cwd } = {}) {
  const override = env?.CONSTRUCT_MCP_BROKER;
  if (override === 'on') return true;
  if (override === 'off') return false;
  const mode = getDeploymentMode(env, { cwd });
  return mode === 'team' || mode === 'enterprise';
}
