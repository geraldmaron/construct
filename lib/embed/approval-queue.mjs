/**
 * lib/embed/approval-queue.mjs — durable approval queue for MCP tool calls.
 *
 * Per ADR-0056 (LMCP-A6), every approval-required tool call creates a durable
 * record with full identity, state machine, and file-backed persistence.
 * Records survive process restart and can be resolved by any authorized actor
 * with queue access.
 *
 * Persistence: JSONL file at `.construct/approvals/queue.jsonl` (team mode) or
 * `doctorRoot()/approvals/queue.jsonl` (solo mode — the XDG state dir, default
 * `~/.local/state/construct/approvals/queue.jsonl`). Written on every state
 * transition.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';
import { configPath } from '../config-dir.mjs';
import { homeDir } from '../paths.mjs';

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
      const loaded = this.#readItemsFromDisk();
      if (loaded) this.#items = loaded;
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
      executedAt: null,
      executionResult: null,
      executionError: null,
      executionAttempts: 0,
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
   * Record the outcome of one control-plane execution attempt against an
   * 'approved' record (lib/writes/control-plane.mjs drainApprovedWriteIntents).
   * Durable so a re-drain after a daemon restart still knows a record already
   * succeeded, or has exhausted its retry budget, without relying solely on
   * an in-memory executed-set. `state` stays 'approved' either way — the
   * generic queue's approval decision is untouched by whether execution
   * itself later succeeds or fails; only lib/writes/ consumers read these
   * fields to decide whether to attempt a record again.
   *
   * @param {string} approvalId
   * @param {object} outcome
   * @param {boolean} outcome.ok
   * @param {object} [outcome.result] - the envelope result, on success
   * @param {string} [outcome.error] - the failure message, on failure
   */
  recordExecutionOutcome(approvalId, { ok, result = null, error = null } = {}) {
    const item = this.#items.get(approvalId);
    if (!item) throw new Error(`Approval record not found: ${approvalId}`);
    if (item.state !== 'approved') {
      throw new Error(`recordExecutionOutcome: ${approvalId} is "${item.state}", not 'approved'`);
    }
    item.executionAttempts = (item.executionAttempts ?? 0) + 1;
    if (ok) {
      item.executedAt = new Date().toISOString();
      item.executionResult = result;
      item.executionError = null;
    } else {
      item.executionError = error;
    }
    this.#persist();
    return item;
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

  /**
   * Re-read the persisted queue file into memory, replacing every in-memory
   * record. A long-running holder of this queue (the embed daemon) mutates
   * and persists in the same process, so its own writes are never at risk —
   * but a human approving/denying via a separate `construct approvals`
   * invocation writes the same file from outside that process, and nothing
   * makes the daemon notice until it re-reads. Call this immediately before
   * any read whose correctness depends on seeing a decision made elsewhere
   * (construct-p4cba.6's follow-up) — e.g. the write-intent-drain job's
   * `list('approved')` scan. A no-op when this instance was never given a
   * persistPath (in-memory-only construction, e.g. most tests).
   */
  reloadFromDisk() {
    if (!this.#persistPath) return;

    // Build into a fresh map and only swap it in on a successful read — a
    // transient read failure (a concurrent writer's non-atomic rewrite, a
    // permissions hiccup) must never clear a good in-memory state down to
    // nothing; #readItemsFromDisk returns null on failure precisely so this
    // can tell "read failed" apart from "file is legitimately empty."

    const loaded = this.#readItemsFromDisk();
    if (loaded) this.#items = loaded;
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

  // Returns a fresh Map of the persisted records, or null on a read failure —
  // never an empty Map for a failure, since a caller deciding whether to
  // adopt the result (reloadFromDisk()) needs to tell a genuine empty/absent
  // file apart from a failed read.

  #readItemsFromDisk() {
    const items = new Map();
    try {
      if (!fs.existsSync(this.#persistPath)) return items;
      const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          items.set(item.approvalId || item.id, item);
        } catch { /* skip malformed line */ }
      }
      return items;
    } catch (err) {
      process.stderr.write('[approval-queue.mjs] load-from-disk: ' + (err?.message ?? String(err)) + '\n');
      return null;
    }
  }

  /**
   * Compute the default persistence path.
   * In team mode: `.construct/approvals/queue.jsonl` under the project root.
   * In solo mode: `doctorRoot()/approvals/queue.jsonl` (XDG state dir).
   */
  static resolvePersistPath(rootDir, deploymentMode) {
    if (deploymentMode === 'team' || deploymentMode === 'enterprise') {
      return configPath(rootDir, 'approvals', 'queue.jsonl');
    }
    // doctorRoot()'s default homeDir param is bare os.homedir(), which does
    // not know about CONSTRUCT_HOME_OVERRIDE (the convention lib/state-root.mjs and
    // every test isolating machine-scoped state relies on) — pass the
    // override-aware homeDir() explicitly so a test that pins
    // CONSTRUCT_HOME_OVERRIDE isolates this path too, not just ADR-0066 state.

    return path.join(doctorRoot(homeDir()), 'approvals', 'queue.jsonl');
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
