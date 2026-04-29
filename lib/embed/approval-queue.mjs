/**
 * lib/embed/approval-queue.mjs — high-risk action approval queue.
 *
 * Actions that match the approval.require list in embed config are held
 * here until approved, rejected, or timed out.
 *
 * Persistence: in-memory by default; optionally writes to a JSONL file
 * at ~/.cx/approval-queue.jsonl for cross-session visibility.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class ApprovalQueue {
  #items = new Map();   // id → ApprovalItem
  #persistPath = null;
  #requirePatterns = [];
  #timeoutMs = 3_600_000;
  #fallback = 'reject';

  /**
   * @param {object} opts
   * @param {string[]} opts.require        - Action type patterns that need approval
   * @param {number}  [opts.timeoutMs]     - Auto-expiry after this many ms (default: 1h)
   * @param {string}  [opts.fallback]      - 'reject' | 'proceed' on timeout
   * @param {string}  [opts.persistPath]   - Path to JSONL persistence file
   */
  constructor({ require: requirePatterns = [], timeoutMs, fallback, persistPath } = {}) {
    this.#requirePatterns = requirePatterns;
    if (timeoutMs != null) this.#timeoutMs = timeoutMs;
    if (fallback) this.#fallback = fallback;
    if (persistPath) {
      this.#persistPath = persistPath;
      this.#loadFromDisk();
    }
  }

  /**
   * Check if an action type requires approval.
   */
  requiresApproval(actionType) {
    return this.#requirePatterns.some((p) => {
      if (p.endsWith('*')) return actionType.startsWith(p.slice(0, -1));
      return p === actionType;
    });
  }

  /**
   * Determine approval mode for an action type.
   * Returns 'auto' if autonomous execution is safe, 'human' if gating required.
   *
   * Hybrid model rules (in priority order):
   *   1. If requiresApproval() → 'human'
   *   2. If action.autoApprove === true → 'auto'
   *   3. If action type matches low-risk patterns → 'auto'
   *   4. Default → 'human' (fail-safe)
   */
  approvalMode(actionType, { autoApprove = false } = {}) {
    if (this.requiresApproval(actionType)) return 'human';
    if (autoApprove) return 'auto';
    const LOW_RISK = ['webhook.', 'snapshot.', 'observation.', 'search.', 'read.'];
    if (LOW_RISK.some(prefix => actionType.startsWith(prefix))) return 'auto';
    return 'human';
  }

  /**
   * Enqueue an action for approval. Returns the item id.
   * @param {object} action - { type, provider, payload, requestedBy?, autoApprove? }
   *
   * If approvalMode resolves to 'auto' the item is immediately auto-approved
   * and persisted with status 'auto-approved'. Callers can check the returned
   * item's status to decide whether to proceed immediately.
   */
  enqueue(action) {
    const id = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mode = this.approvalMode(action.type ?? action.action ?? 'unknown', {
      autoApprove: action.autoApprove === true,
    });
    const item = {
      id,
      type: action.type ?? action.action ?? 'unknown',
      provider: action.provider ?? null,
      payload: action.payload ?? {},
      requestedBy: action.requestedBy ?? 'construct',
      approvalMode: mode,
      status: mode === 'auto' ? 'auto-approved' : 'pending',
      enqueuedAt: new Date().toISOString(),
      resolvedAt: mode === 'auto' ? new Date().toISOString() : null,
      expiresAt: new Date(Date.now() + this.#timeoutMs).toISOString(),
    };
    this.#items.set(id, item);
    this.#persist();
    return id;
  }

  /**
   * Approve a pending item. Returns the resolved item.
   */
  approve(id, { approvedBy = 'human' } = {}) {
    return this.#resolve(id, 'approved', { approvedBy });
  }

  /**
   * Reject a pending item.
   */
  reject(id, { reason = '' } = {}) {
    return this.#resolve(id, 'rejected', { reason });
  }

  /**
   * Get an item by id.
   */
  get(id) {
    return this.#items.get(id) ?? null;
  }

  /**
   * List all items, optionally filtered by status.
   */
  list(status = null) {
    const items = [...this.#items.values()];
    return status ? items.filter((i) => i.status === status) : items;
  }

  /**
   * Expire any pending items past their expiry time.
   * Returns the list of expired items.
   */
  expireStale() {
    const now = Date.now();
    const expired = [];
    for (const item of this.#items.values()) {
      if (item.status === 'pending' && new Date(item.expiresAt).getTime() < now) {
        this.#resolve(item.id, this.#fallback === 'proceed' ? 'approved' : 'expired');
        expired.push(item);
      }
    }
    return expired;
  }

  #resolve(id, status, extra = {}) {
    const item = this.#items.get(id);
    if (!item) throw new Error(`Approval item not found: ${id}`);
    if (item.status !== 'pending') throw new Error(`Item ${id} is already ${item.status}`);
    Object.assign(item, { status, resolvedAt: new Date().toISOString(), ...extra });
    this.#persist();
    return item;
  }

  #persist() {
    if (!this.#persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
      const lines = [...this.#items.values()].map((i) => JSON.stringify(i)).join('\n');
      fs.writeFileSync(this.#persistPath, lines + '\n', 'utf8');
    } catch { /* non-critical */ }
  }

  #loadFromDisk() {
    try {
      if (!fs.existsSync(this.#persistPath)) return;
      const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          this.#items.set(item.id, item);
        } catch { /* skip malformed */ }
      }
    } catch { /* non-critical */ }
  }

  static defaultPersistPath() {
    return path.join(os.homedir(), '.cx', 'approval-queue.jsonl');
  }
}
