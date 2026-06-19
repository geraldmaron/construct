/**
 * lib/oracle/policy.mjs — bounded-auto policy for Oracle recommended actions.
 *
 * Classifies each action kind as auto (execute without approval), approve
 * (queue for human review), auto-raise (beads create for high gaps), or deny.
 */

export const AUTO_ACTIONS = new Set([
  'census-run',
  'registry-validate',
  'adapters-sync',
]);

export const APPROVE_ACTIONS = new Set([
  'specialist-review',
  'doctor-followup',
  'trace-review',
  'outcomes-aggregate',
  'parity-fix-manual',
  'registry-consolidation',
  'executive-signoff-required',
  'structure-cleanup-proposal',
]);

const DENY_ACTIONS = new Set([
  'git-push',
  'git-commit',
  'destructive-delete',
  'force-sync',
]);

/**
 * @param {string} kind — recommended action kind from synthesizeVerdict
 * @returns {'auto'|'approve'|'deny'}
 */
export function classifyAction(kind) {
  if (!kind || typeof kind !== 'string') return 'deny';
  if (DENY_ACTIONS.has(kind)) return 'deny';
  if (AUTO_ACTIONS.has(kind)) return 'auto';
  if (APPROVE_ACTIONS.has(kind)) return 'approve';
  return 'approve';
}

/**
 * Whether high-severity gaps should auto-raise beads (idempotent).
 */
export function autoRaiseEnabled(env = process.env) {
  if (env.CONSTRUCT_ORACLE === 'off' || env.CONSTRUCT_ORACLE === '0') return false;
  if (env.CONSTRUCT_ORACLE_AUTO_RAISE === 'off' || env.CONSTRUCT_ORACLE_AUTO_RAISE === '0') return false;
  return true;
}
