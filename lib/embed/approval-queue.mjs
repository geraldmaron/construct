/**
 * lib/embed/approval-queue.mjs — durable approval queue for MCP tool calls.
 *
 * Per ADR-0056 (LMCP-A6), every approval-required tool call creates a durable
 * record with full identity, state machine, and file-backed persistence.
 * Records survive process restart and can be resolved by any authorized actor
 * with queue access.
 *
 * States: 'awaiting_approval' -> 'approved' | 'denied' | 'expired'; an
 * 'approved' record may further transition to 'executing' (lease held,
 * acquireLease/heartbeatLease/releaseLease/reclaimExpiredLeases, ADR-0089)
 * and from there to the terminal 'executed', or back to 'approved' on a
 * failed or expired lease. The durable execution lease is the safe-requeue
 * primitive for drainApprovedWriteIntents (lib/writes/control-plane.mjs),
 * not yet wired into the drain itself (construct-4uxq0.9.5).
 *
 * Persistence: JSONL file at `.construct/approvals/queue.jsonl` (team mode) or
 * `~/.cx/approvals/queue.jsonl` (solo mode). Written on every state transition.
 *
 * Cross-process safety (construct-4uxq0.9.9): #persist() rewrites the whole
 * file from the in-memory map, so every mutator follows reload -> mutate-by-id
 * -> atomic persist, and every public reader reloads before answering —
 * otherwise a stale instance would clobber sibling-process records on write
 * or serve stale state from long-lived processes (the daemon). Reload merges
 * disk-wins by approvalId into the existing in-memory objects, preserving
 * reference identity for callers holding records across calls. A transition
 * whose target record was resolved by another process since the last load
 * surfaces as the state machine's existing invalid-transition error, never
 * as a silent last-writer-wins overwrite.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';
import { configPath } from '../config-dir.mjs';

const APPROVAL_TTL_MS = 3_600_000; // 1 hour default

// Mirrors PG_QUEUE_DEFAULT_LEASE_SECONDS (lib/queue/pg-queue.mjs) so both
// durable execution loops ADR-0089 governs default to the same lease window.
const LEASE_DEFAULT_SECONDS = 120;

let writeCounter = 0;

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

    // Reload before dedup: a sibling process may have persisted a record for
    // the same tool+args since the last on-disk read. #loadFromDisk merges
    // by approvalId without clearing #items first, so repeated calls are
    // idempotent per-key and only widen visibility, never lose records.
    this.#loadFromDisk();
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
   * Get a record by approvalId. Reloads from disk first so long-lived
   * processes observe transitions persisted by sibling processes.
   */
  getById(approvalId) {
    this.#loadFromDisk();
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
   * Get all records with state `awaiting_approval`. Reloads from disk first.
   */
  getPending() {
    this.#loadFromDisk();
    const results = [];
    for (const item of this.#items.values()) {
      if (item.state === 'awaiting_approval') results.push(item);
    }
    return results;
  }

  /**
   * Look up a record by resumeToken. Reloads from disk first.
   */
  getByResumeToken(resumeToken) {
    this.#loadFromDisk();
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
   * Reloads from disk first.
   */
  findByToolArgs(tool, argsHash) {
    this.#loadFromDisk();
    return this.#findByToolArgs(tool, argsHash);
  }

  /**
   * Expire any awaiting_approval records past their expiry time.
   * Returns the list of expired records. Reloads once before the sweep and
   * persists once after it, so a sweep from a stale instance never drops
   * records persisted by sibling processes and never expires a record
   * another process already resolved.
   */
  expireStale() {
    this.#loadFromDisk();
    const now = Date.now();
    const expired = [];
    for (const item of this.#items.values()) {
      if (item.state === 'awaiting_approval' && new Date(item.expiresAt).getTime() < now) {
        item.state = 'expired';
        item.decidedAt = new Date().toISOString();
        item.reason = 'auto-expired';
        expired.push(item);
      }
    }
    if (expired.length) this.#persist();
    return expired;
  }

  /**
   * Atomically transition an 'approved' record to 'executing' with a lease
   * expiry, or reclaim an 'executing' record whose lease has already
   * expired (a crashed or partitioned holder). Reloads from disk first —
   * same pattern enqueue() uses for cross-process dedup (ADR-0056) — so a
   * second caller racing the same record observes the first acquirer's
   * persisted state instead of a stale in-memory view; per ADR-0089 this is
   * the durable replacement for drainApprovedWriteIntents's in-memory
   * executedApprovalIds Set (lib/writes/control-plane.mjs:123).
   *
   * Returns null, not a throw, when the record is not eligible (already
   * leased and live, or in a state that was never approved) — losing a
   * lease race is an expected outcome for a caller, not a caller error.
   *
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {number} [opts.leaseSeconds] - lease duration (default 120s)
   * @param {string} [opts.workerId]     - identity recorded as the lease holder
   * @returns {object|null} the record in state 'executing', or null if not acquired
   */
  acquireLease(approvalId, { leaseSeconds = LEASE_DEFAULT_SECONDS, workerId = null } = {}) {
    this.#loadFromDisk();
    const item = this.#items.get(approvalId);
    if (!item) throw new Error(`Approval record not found: ${approvalId}`);

    const now = Date.now();
    const leaseIsLive = item.state === 'executing' && item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() > now;
    const eligible = item.state === 'approved' || (item.state === 'executing' && !leaseIsLive);
    if (!eligible) return null;

    item.state = 'executing';
    item.leaseWorkerId = workerId;
    item.leaseAcquiredAt = new Date(now).toISOString();
    item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();
    this.#persist();
    return item;
  }

  /**
   * Extend a live lease. Fails closed (returns null) if the caller no
   * longer holds a non-expired lease on this record, so a heartbeat from a
   * worker whose lease already expired can never resurrect it out from
   * under whoever has since reacquired it.
   *
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {number} [opts.leaseSeconds] - new lease duration from now (default 120s)
   * @param {string} [opts.workerId]     - if given, must match the current lease holder
   * @returns {object|null} the record with extended leaseExpiresAt, or null if the lease is not live
   */
  heartbeatLease(approvalId, { leaseSeconds = LEASE_DEFAULT_SECONDS, workerId = null } = {}) {
    this.#loadFromDisk();
    const item = this.#items.get(approvalId);
    if (!item) throw new Error(`Approval record not found: ${approvalId}`);

    const now = Date.now();
    const leaseIsLive = item.state === 'executing' && item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() > now;
    if (!leaseIsLive) return null;
    if (workerId != null && item.leaseWorkerId !== workerId) return null;

    item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();
    this.#persist();
    return item;
  }

  /**
   * Release a lease after an execution attempt. Success moves the record
   * to the terminal 'executed' state — a durable stand-in for what
   * drainApprovedWriteIntents's executedApprovalIds Set tracked only in
   * memory (ADR-0089), so a record already executed is never re-attempted.
   * Failure returns the record to 'approved' so a later acquireLease() can
   * retry it, mirroring PostgresIntakeQueue.fail() releasing a claimed job
   * back to 'pending' (lib/queue/pg-queue.mjs).
   *
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {string} [opts.workerId] - if given, must match the current lease holder
   * @param {'success'|'failure'} [opts.outcome]
   * @param {string} [opts.reason]   - recorded when outcome is 'failure'
   * @returns {object} the released record
   */
  releaseLease(approvalId, { workerId = null, outcome = 'success', reason = null } = {}) {
    this.#loadFromDisk();
    const item = this.#items.get(approvalId);
    if (!item) throw new Error(`Approval record not found: ${approvalId}`);
    if (item.state !== 'executing') {
      throw new Error(`releaseLease: ${approvalId} has no active lease (state=${item.state})`);
    }
    if (workerId != null && item.leaseWorkerId !== workerId) {
      throw new Error(`releaseLease: ${approvalId}'s lease is held by a different worker`);
    }

    if (outcome === 'success') {
      item.state = 'executed';
      item.executedAt = new Date().toISOString();
    } else {
      item.state = 'approved';
      item.lastLeaseFailureReason = reason;
    }
    item.leaseWorkerId = null;
    item.leaseAcquiredAt = null;
    item.leaseExpiresAt = null;
    this.#persist();
    return item;
  }

  /**
   * Reclaim 'executing' records whose lease has expired (crashed or
   * partitioned holder) back to 'approved' — the safe-requeue path this
   * bead's acceptance criteria names. Unlike expireStale()'s handling of
   * 'awaiting_approval' records, an expired lease never resolves to a
   * terminal state: a crash mid-execution must stay retryable, not
   * dead-end the record.
   *
   * @returns {object[]} records reclaimed back to 'approved'
   */
  reclaimExpiredLeases() {
    this.#loadFromDisk();
    const now = Date.now();
    const reclaimed = [];
    for (const item of this.#items.values()) {
      if (item.state === 'executing' && item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() < now) {
        item.state = 'approved';
        item.leaseWorkerId = null;
        item.leaseAcquiredAt = null;
        item.leaseExpiresAt = null;
        reclaimed.push(item);
      }
    }
    if (reclaimed.length) this.#persist();
    return reclaimed;
  }

  /**
   * List all records, optionally filtered by state. Reloads from disk first
   * so long-lived callers (the daemon's drain loop and status surface) see
   * records enqueued or resolved by sibling processes.
   */
  list(state = null) {
    this.#loadFromDisk();
    const items = [...this.#items.values()];
    return state ? items.filter((i) => i.state === state) : items;
  }

  /**
   * Transition an awaiting_approval record to a decided state. Reloads from
   * disk first — same pattern as enqueue() and the lease methods — so the
   * whole-file persist never drops records sibling processes wrote since the
   * last load. When the reload reveals another process already resolved the
   * target record, the invalid-transition throw below fires with the
   * sibling's persisted state, refusing the decision instead of silently
   * overwriting it (last-writer-wins is the lost-update class this closes).
   */
  #resolve(approvalId, newState, extra = {}) {
    this.#loadFromDisk();
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
      writeCounter = (writeCounter + 1) % 100000;
      const tmp = `${this.#persistPath}.${process.pid}.${writeCounter}.tmp`;
      fs.writeFileSync(tmp, lines + '\n', 'utf8');
      fs.renameSync(tmp, this.#persistPath);
    } catch (err) {
      process.stderr.write('[approval-queue.mjs] persist: ' + (err?.message ?? String(err)) + '\n');
    }
  }

  /**
   * Merge the persisted file's records into this instance, disk-wins by
   * approvalId. Every public reader already reloads per call
   * (construct-4uxq0.9.9) — this public entry point exists for callers that
   * hold a record reference across calls and want to refresh it explicitly
   * before a read-modify decision. A no-op when this instance was never
   * given a persistPath (in-memory-only construction, e.g. most tests), and
   * a failed read never clears good in-memory state — the merge only ever
   * adds or updates records, it does not remove them.
   */
  reloadFromDisk() {
    this.#loadFromDisk();
  }

  #loadFromDisk() {
    if (!this.#persistPath) return;
    try {
      if (!fs.existsSync(this.#persistPath)) return;
      const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          const id = item.approvalId || item.id;

          // Disk wins on merge: every mutator persists before returning, so
          // the persisted copy is always at least as new as the in-memory
          // one. Assigning into the existing object (instead of replacing
          // it) keeps record references held by callers coherent across the
          // per-call reloads the readers and mutators now perform.
          const existing = this.#items.get(id);
          if (existing) Object.assign(existing, item);
          else this.#items.set(id, item);
        } catch { /* skip malformed */ }
      }
    } catch (err) {
      process.stderr.write('[approval-queue.mjs] load-from-disk: ' + (err?.message ?? String(err)) + '\n');
    }
  }

  /**
   * Compute the default persistence path.
   * In team mode: `.construct/approvals/queue.jsonl` under the project root.
   * In solo mode: `~/.cx/approvals/queue.jsonl` (via doctorRoot).
   */
  static resolvePersistPath(rootDir, deploymentMode) {
    if (deploymentMode === 'team' || deploymentMode === 'enterprise') {
      return configPath(rootDir, 'approvals', 'queue.jsonl');
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