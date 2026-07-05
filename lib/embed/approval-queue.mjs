/**
 * lib/embed/approval-queue.mjs — durable approval queue for MCP tool calls.
 *
 * Per ADR-0056 (LMCP-A6), every approval-required tool call creates a durable
 * record with full identity, state machine, and file-backed persistence.
 * Records survive process restart and can be resolved by any authorized actor
 * with queue access.
 *
 * Persistence: JSONL file at `.cx/approvals/queue.jsonl` (team mode) or
 * `~/.cx/approvals/queue.jsonl` (solo mode). Written on every state transition.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';

const APPROVAL_TTL_MS = 3_600_000; // 1 hour default

export class ApprovalQueue {
  #items = new Map();
  #persistPath = null;
  #timeoutMs = APPROVAL_TTL_MS;

  /**
   * @param {object} opts
   * @param {string}  [opts.persistPath]  - Path to JSONL persistence file
   * @param {number}  [opts.timeoutMs]    - Auto-expiry after this many ms (default: 1h)
   */
  constructor({ persistPath, timeoutMs } = {}) {
    if (timeoutMs != null) this.#timeoutMs = timeoutMs;
    if (persistPath) {
      this.#persistPath = persistPath;
      this.#loadFromDisk();
    }
  }

  /**
   * Compute a deterministic hash from tool name and args.
   */
  static hashToolCall(tool, args) {
    const stable = JSON.stringify(sortKeys({ tool, args: args ?? {} }));
    return crypto.createHash('sha256').update(stable).digest('hex');
  }

  /**
   * Enqueue a tool call for approval. Returns the full approval record.
   *
   * If an identical tool call (same tool + argsHash) already exists with
   * status `awaiting_approval`, returns the existing record instead of
   * creating a duplicate.
   *
   * @param {object} spec
   * @param {string} spec.tool       - Tool name
   * @param {object} spec.args       - Tool arguments
   * @param {string} spec.surface    - Interaction surface (e.g. 'mcp', 'cli')
   * @param {string} spec.argsHash   - Pre-computed hash (optional, computed if absent)
   * @param {object} spec.requestedBy - Actor identity { userId, serviceId, tenantId, sessionId, role }
   * @returns {object} Full approval record
   */
  enqueue(spec) {
    const { tool, args = {}, surface = 'mcp', requestedBy = {} } = spec;
    const argsHash = spec.argsHash || ApprovalQueue.hashToolCall(tool, args);

    const existing = this.#findByToolArgs(tool, argsHash);
    if (existing && existing.state === 'awaiting_approval') {
      return existing;
    }

    const approvalId = `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const resumeToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    const record = {
      approvalId,
      toolCall: { tool, args, surface, argsHash },
      requestedAt: now.toISOString(),
      requestedBy: {
        userId: requestedBy.userId ?? null,
        serviceId: requestedBy.serviceId ?? null,
        tenantId: requestedBy.tenantId ?? null,
        sessionId: requestedBy.sessionId ?? null,
        role: requestedBy.role ?? null,
      },
      state: 'awaiting_approval',
      decidedAt: null,
      decidedBy: null,
      reason: null,
      resumeToken,
      expiresAt: new Date(now.getTime() + this.#timeoutMs).toISOString(),
    };

    this.#items.set(approvalId, record);
    this.#persist();
    return record;
  }

  /**
   * Approve a pending approval. Returns the resolved record.
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {object} [opts.decidedBy] - Actor identity of the decider
   * @param {string} [opts.reason]
   */
  approve(approvalId, { decidedBy = {}, reason = null } = {}) {
    return this.#resolve(approvalId, 'approved', { decidedBy, reason });
  }

  /**
   * Deny a pending approval. Returns the resolved record.
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {object} [opts.decidedBy] - Actor identity of the decider
   * @param {string} [opts.reason]
   */
  deny(approvalId, { decidedBy = {}, reason = null } = {}) {
    return this.#resolve(approvalId, 'denied', { decidedBy, reason });
  }

  /**
   * Get a record by approvalId.
   */
  getById(approvalId) {
    return this.#items.get(approvalId) ?? null;
  }

  /** @deprecated Use getById() — kept for backward compat with old tests. */
  get(id) {
    if (typeof id === 'object' || id === null || id === undefined) return null;
    return this.getById(id);
  }

  /** @deprecated Kept for backward compat; always returns false (policy decides). */
  requiresApproval() {
    return false;
  }

  /** @deprecated Use deny() — kept for backward compat with old tests. */
  reject(id, opts = {}) {
    const reason = opts?.reason ?? null;
    return this.deny(id, { decidedBy: opts?.decidedBy ?? {}, reason });
  }

  /**
   * Get all records with state `awaiting_approval`.
   */
  getPending() {
    const results = [];
    for (const item of this.#items.values()) {
      if (item.state === 'awaiting_approval') results.push(item);
    }
    return results;
  }

  /**
   * Look up a record by resumeToken.
   */
  getByResumeToken(resumeToken) {
    for (const item of this.#items.values()) {
      if (item.resumeToken === resumeToken) return item;
    }
    return null;
  }

  /**
   * Find a record by tool + argsHash (for dedup).
   */
  #findByToolArgs(tool, argsHash) {
    for (const item of this.#items.values()) {
      if (item.toolCall?.tool === tool && item.toolCall?.argsHash === argsHash) {
        return item;
      }
    }
    return null;
  }

  /**
   * Find a record by tool + argsHash (public, for broker lookup).
   */
  findByToolArgs(tool, argsHash) {
    return this.#findByToolArgs(tool, argsHash);
  }

  /**
   * Expire any awaiting_approval records past their expiry time.
   * Returns the list of expired records.
   */
  expireStale() {
    const now = Date.now();
    const expired = [];
    for (const item of this.#items.values()) {
      if (item.state === 'awaiting_approval' && new Date(item.expiresAt).getTime() < now) {
        this.#resolve(item.approvalId, 'expired', { reason: 'auto-expired' });
        expired.push(item);
      }
    }
    return expired;
  }

  /**
   * List all records, optionally filtered by state.
   */
  list(state = null) {
    const items = [...this.#items.values()];
    return state ? items.filter((i) => i.state === state) : items;
  }

  #resolve(approvalId, newState, extra = {}) {
    const item = this.#items.get(approvalId);
    if (!item) throw new Error(`Approval record not found: ${approvalId}`);
    if (item.state !== 'awaiting_approval') {
      throw new Error(`Approval ${approvalId} is already ${item.state}`);
    }
    const now = new Date();
    item.state = newState;
    item.decidedAt = now.toISOString();
    if (extra.decidedBy) item.decidedBy = extra.decidedBy;
    if (extra.reason) item.reason = extra.reason;
    this.#persist();
    return item;
  }

  #persist() {
    if (!this.#persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
      const lines = [...this.#items.values()].map((i) => JSON.stringify(i)).join('\n');
      fs.writeFileSync(this.#persistPath, lines + '\n', 'utf8');
    } catch (err) {
      process.stderr.write('[approval-queue.mjs] persist: ' + (err?.message ?? String(err)) + '\n');
    }
  }

  #loadFromDisk() {
    try {
      if (!fs.existsSync(this.#persistPath)) return;
      const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          this.#items.set(item.approvalId || item.id, item);
        } catch { /* skip malformed */ }
      }
    } catch (err) {
      process.stderr.write('[approval-queue.mjs] load-from-disk: ' + (err?.message ?? String(err)) + '\n');
    }
  }

  /**
   * Compute the default persistence path.
   * In team mode: `.cx/approvals/queue.jsonl` under the project root.
   * In solo mode: `~/.cx/approvals/queue.jsonl` (via doctorRoot).
   */
  static resolvePersistPath(rootDir, deploymentMode) {
    if (deploymentMode === 'team' || deploymentMode === 'enterprise') {
      return path.join(rootDir, '.cx', 'approvals', 'queue.jsonl');
    }
    return path.join(doctorRoot(), 'approvals', 'queue.jsonl');
  }
}

/**
 * Recursively sort the keys of an object for deterministic JSON serialization.
 */
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}