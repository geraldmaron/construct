/**
 * lib/embed/authority-guard.mjs — runtime enforcement of operating profile authority boundaries.
 *
 * Maps the authority fields declared in the embedded operating profile to
 * actual allow/queue/deny decisions. Consults the ApprovalQueue for
 * `approval-queued` actions and lets `autonomous` actions pass immediately.
 *
 * Authority fields (from DEFAULT_OPERATING_PROFILE.authority):
 *   - read            → autonomous
 *   - summarize       → autonomous
 *   - draftArtifacts  → autonomous
 *   - createIssues    → approval-queued
 *   - updateIssues    → approval-queued
 *   - publishDocs     → approval-queued
 *   - externalPost    → approval-queued
 *   - repoWrites      → approval-queued
 *
 * Usage:
 *   const guard = new AuthorityGuard(operatingProfile, approvalQueue);
 *   const result = await guard.check('externalPost', { description: 'Post roadmap to Slack' });
 *   if (result.allowed) { ... execute ... }
 *   else { ... it's been queued or denied ... }
 *
 * Per-specialist binding enforcement: the operating-profile
 * authority level answers "is this action *class* ever permitted" but has no
 * per-Worker Profile dimension — nothing stopped an embedded Worker Profile from
 * reading any provider or proposing any external write. When the caller
 * passes `meta.proposal = { workerProfileId, providerId, writeKind }`, `check()`
 * consults the Worker Profile's `embedBindings` grant (lib/packs/manifest-schema.mjs)
 * *before* the authority-level/queue logic runs: a `<providerId>.<writeKind>`
 * token not present in that specialist's `proposals[]` is denied outright,
 * never queued. Callers that omit `meta.proposal` are unaffected — this is
 * additive, backward-compatible enforcement layered in front of the existing
 * authority-level check.
 */

import { ApprovalQueue } from './approval-queue.mjs';

// ─── Action-type → authority-key mapping ────────────────────────────────────

const ACTION_TO_AUTHORITY = {
  // Read / summarize
  read: 'read',
  summarize: 'summarize',
  // Artifact drafting
  draftArtifacts: 'draftArtifacts',
  'artifact:prd': 'draftArtifacts',
  'artifact:adr': 'draftArtifacts',
  'artifact:rfc': 'draftArtifacts',
  'artifact:memo': 'draftArtifacts',
  // Issue management
  createIssues: 'createIssues',
  'issue:create': 'createIssues',
  updateIssues: 'updateIssues',
  'issue:update': 'updateIssues',
  // Documentation publishing
  publishDocs: 'publishDocs',
  'docs:publish': 'publishDocs',
  'docs:write': 'publishDocs',
  // External messaging
  externalPost: 'externalPost',
  'slack:post': 'externalPost',
  'email:send': 'externalPost',
  // Repo writes
  repoWrites: 'repoWrites',
  'git:commit': 'repoWrites',
  'git:push': 'repoWrites',
  'git:pr': 'repoWrites',
};

/**
 * Resolve the authority key for an action type.
 * Falls back to the action type itself (for forward-compat).
 */
function resolveAuthorityKey(actionType) {
  return ACTION_TO_AUTHORITY[actionType] ?? actionType;
}

// ─── AuthorityGuard ──────────────────────────────────────────────────────────

export class AuthorityGuard {
  #authority;
  #approvalQueue;
  #embedBindings;

  /**
   * @param {object} operatingProfile  - The embed config's operatingProfile object
   * @param {ApprovalQueue} approvalQueue
   * @param {object} [embedBindings]   - Map of workerProfileId → { providers[], proposals[] }
   *                                     (lib/packs/manifest-schema.mjs embedBindings shape).
   *                                     Consulted only when a check's meta.proposal names
   *                                     a workerProfileId; omit for non-embed callers.
   */
  constructor(operatingProfile, approvalQueue, embedBindings = {}) {
    this.#authority = operatingProfile?.authority ?? {};
    this.#approvalQueue = approvalQueue;
    this.#embedBindings = embedBindings ?? {};
  }

  /**
   * Check a proposed embed action against the specialist's binding grant.
   * Returns `null` when no binding-scoped check applies (no proposal meta,
   * or no bindings configured) so the caller falls through to the ordinary
   * authority-level check unaffected.
   *
   * @param {{workerProfileId: string, providerId: string, writeKind: string}} proposal
   * @returns {{ allowed: boolean, mode: string, reason: string }|null}
   */
  #checkProposalBinding(proposal) {
    if (!proposal || !proposal.workerProfileId) return null;

    const { workerProfileId, providerId, writeKind } = proposal;
    const binding = this.#embedBindings[workerProfileId];

    if (!binding) {
      return {
        allowed: false,
        mode: 'denied',
        reason: `Worker Profile "${workerProfileId}" has no embedBindings grant — no providers or proposals are authorized`,
      };
    }

    const token = writeKind ? `${providerId}.${writeKind}` : providerId;
    const grantedProposals = new Set(binding.proposals || []);

    if (!grantedProposals.has(token)) {
      return {
        allowed: false,
        mode: 'denied',
        reason: `Worker Profile "${workerProfileId}" is not granted to propose "${token}" (embedBindings.proposals: ${[...grantedProposals].join(', ') || '(none)'})`,
      };
    }

    return null;
  }

  /**
   * Check whether an action is allowed under the current authority profile.
   *
   * @param {string} actionType   - e.g. 'externalPost', 'artifact:prd', 'issue:create'
   * @param {object} [meta]       - Optional metadata: { description, payload, proposal }
   * @param {{workerProfileId: string, providerId: string, writeKind: string}} [meta.proposal]
   * Embed-originated proposal descriptor. When present, the
   *        proposal is checked against the Worker Profile's embedBindings grant
   *        before any authority-level/queue logic runs; a proposal outside
   *        the grant is denied and never queued.
   * @returns {{ allowed: boolean, mode: string, queueId?: string, reason?: string }}
   */
  async check(actionType, meta = {}) {
    const bindingDenial = this.#checkProposalBinding(meta.proposal);
    if (bindingDenial) return bindingDenial;

    const key = resolveAuthorityKey(actionType);
    const level = this.#authority[key] ?? 'approval-queued'; // fail-safe default

    if (level === 'autonomous') {
      return { allowed: true, mode: 'autonomous' };
    }

    if (level === 'denied') {
      return { allowed: false, mode: 'denied', reason: `Authority level for "${key}" is denied` };
    }

    // approval-queued: consult the ApprovalQueue
    if (this.#approvalQueue) {
      // ApprovalQueue keys records by { tool, args } — use the resolved
      // authority key (not the raw alias) as the tool identity, so aliases
      // like 'slack:post' and 'externalPost' dedupe into the same queued
      // class of action, and the payload as args so distinct payloads get
      // distinct hashes.
      const args = meta.payload ?? {};
      const argsHash = ApprovalQueue.hashToolCall(key, args);

      // ApprovalQueue carries no separate auto-allow concept; an approved
      // record for the identical tool+args is the only durable clearance
      // signal available, so it authorizes without re-queuing.
      const existing = this.#approvalQueue.findByToolArgs(key, argsHash);
      if (existing?.state === 'approved') {
        return { allowed: true, mode: 'auto-approved', queueId: existing.approvalId };
      }

      // Queue the action and return not-yet-allowed
      const record = this.#approvalQueue.enqueue({
        tool: key,
        args,
        surface: 'embed-daemon',
        argsHash,
      });
      return {
        allowed: false,
        mode: 'queued',
        queueId: record.approvalId,
        reason: `Action "${actionType}" requires human approval (authority: ${key} = approval-queued)`,
      };
    }

    // No approval queue present — default to deny for safety
    return {
      allowed: false,
      mode: 'no-queue',
      reason: `Action "${actionType}" requires approval but no ApprovalQueue is configured`,
    };
  }

  /**
   * Synchronous check — returns allowed: true only for autonomous actions.
   * Use this where async is not possible.
   */
  checkSync(actionType) {
    const key = resolveAuthorityKey(actionType);
    const level = this.#authority[key] ?? 'approval-queued';
    return { allowed: level === 'autonomous', mode: level };
  }

  /**
   * Return a summary of the current authority settings for diagnostics.
   */
  summary() {
    const autonomous = [];
    const queued = [];
    const denied = [];
    for (const [k, v] of Object.entries(this.#authority)) {
      if (v === 'autonomous') autonomous.push(k);
      else if (v === 'denied') denied.push(k);
      else queued.push(k);
    }
    return { autonomous, queued, denied };
  }
}
