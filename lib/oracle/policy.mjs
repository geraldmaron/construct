/**
 * lib/oracle/policy.mjs — bounded-auto policy for Oracle recommended actions.
 *
 * Classifies each action kind as auto (execute without approval), approve
 * (queue for human review), auto-raise (beads create for high gaps), or deny.
 * Hygiene and meta gaps are verdict-only — they surface in doctor, prelude, and
 * construct oracle gaps but never auto-raise tracker beads.
 */

export const AUTO_ACTIONS = new Set([
  'census-run',
  'registry-validate',
  'adapters-sync',
]);

export const APPROVE_ACTIONS = new Set([
  'worker-profile-review',
  'doctor-followup',
  'trace-review',
  'outcomes-aggregate',
  'parity-fix-manual',
  'registry-consolidation',
  'executive-signoff-required',
  'structure-cleanup-proposal',
  'directive-due',
]);

export const VERDICT_ONLY_GAP_IDS = new Set([
  'beads-hygiene',
  'workflow-misaligned',
  'propagation-stale',
  'census-stale',
  'outcomes-missing',
  'tool-discoverability',
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

/**
 * @param {{ id?: string }} gap
 * @returns {boolean}
 */
export function isVerdictOnlyGap(gap) {
  return VERDICT_ONLY_GAP_IDS.has(gap?.id);
}

/**
 * @param {{ id?: string, severity?: string }} gap
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function autoRaiseEnabledForGap(gap, env = process.env) {
  if (!autoRaiseEnabled(env)) return false;
  if (isVerdictOnlyGap(gap)) return false;
  return gap?.severity === 'high';
}
