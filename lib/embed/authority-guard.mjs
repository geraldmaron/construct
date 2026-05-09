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
 */

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

  /**
   * @param {object} operatingProfile  - The embed config's operatingProfile object
   * @param {ApprovalQueue} approvalQueue
   */
  constructor(operatingProfile, approvalQueue) {
    this.#authority = operatingProfile?.authority ?? {};
    this.#approvalQueue = approvalQueue;
  }

  /**
   * Check whether an action is allowed under the current authority profile.
   *
   * @param {string} actionType   - e.g. 'externalPost', 'artifact:prd', 'issue:create'
   * @param {object} [meta]       - Optional metadata: { description, payload }
   * @returns {{ allowed: boolean, mode: string, queueId?: string, reason?: string }}
   */
  async check(actionType, meta = {}) {
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
      // Check if there's already an approved item for this action
      const mode = this.#approvalQueue.approvalMode(actionType);
      if (mode === 'auto') {
        return { allowed: true, mode: 'auto-approved' };
      }

      // Queue the action and return not-yet-allowed
      const queueId = this.#approvalQueue.enqueue({
        type: actionType,
        authorityKey: key,
        description: meta.description ?? actionType,
        payload: meta.payload ?? {},
        requestedAt: new Date().toISOString(),
      });
      return {
        allowed: false,
        mode: 'queued',
        queueId,
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
