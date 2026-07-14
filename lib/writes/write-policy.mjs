/**
 * lib/writes/write-policy.mjs — per-write-kind auto/approval/deny policy.
 *
 * A writeIntent's tool name ("<providerId>.<writeKind>", e.g. "jira.issue")
 * is a finer-grained key than lib/embed/authority-guard.mjs's coarse
 * authority buckets (createIssues, externalPost, ...). This module bridges
 * the two — WRITE_KIND_AUTHORITY maps a known tool name to the authority key
 * that governs it — and holds the (currently unconsumed) auto/approval/deny
 * policy table that construct-p4cba.3 (write-intent-drain) will read to
 * decide which approved-by-policy writes skip the human queue. Fail-safe
 * default is 'approval': an unrecognized or unconfigured write always waits
 * for a human until something explicitly opts it into 'auto'.
 */

import { KNOWN_PROVIDERS } from './write-intent.mjs';

export const WRITE_POLICY_MODES = Object.freeze(['auto', 'approval', 'deny']);
export const DEFAULT_WRITE_POLICY_MODE = 'approval';

/**
 * Tool name → the lib/embed/authority-guard.mjs authority key that governs
 * it. Only covers write kinds the governed adapters
 * (lib/providers/contract/adapters/*\/governed-write.mjs) actually implement;
 * an unlisted kind falls back to 'externalPost' in resolveWriteAuthorityKey,
 * the broadest approval-queued bucket, rather than silently mapping to
 * nothing.
 */
export const WRITE_KIND_AUTHORITY = Object.freeze({
  'jira.issue': 'createIssues',
  'jira.comment': 'updateIssues',
  'github.issue': 'createIssues',
  'github.pr': 'repoWrites',
  'confluence.page': 'publishDocs',
  'confluence.page-update': 'publishDocs',
});

/**
 * Resolve the authority-guard key for a governed write. Unknown providers or
 * write kinds fail safe to 'externalPost' rather than throwing, so a new
 * governed adapter that ships without a WRITE_KIND_AUTHORITY entry still
 * queues for approval instead of silently bypassing the guard.
 *
 * @param {string} providerId
 * @param {string} writeKind
 * @returns {string}
 */
export function resolveWriteAuthorityKey(providerId, writeKind) {
  return WRITE_KIND_AUTHORITY[`${providerId}.${writeKind}`] ?? 'externalPost';
}

/**
 * Validate a `writes.policy` config block: `{ "<providerId>.<writeKind>": "auto"|"approval"|"deny" }`.
 * Returns `{ ok: true }` or `{ ok: false, errors: string[] }` — never throws.
 *
 * @param {object} policy
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validateWritePolicyConfig(policy) {
  if (policy === undefined) return { ok: true };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { ok: false, errors: ['writes.policy must be an object'] };
  }
  const errors = [];
  for (const [tool, mode] of Object.entries(policy)) {
    const [providerId] = tool.split('.');
    if (!KNOWN_PROVIDERS.includes(providerId)) {
      errors.push(`writes.policy["${tool}"]: "${providerId}" is not a known governed provider (${KNOWN_PROVIDERS.join(', ')})`);
    }
    if (!WRITE_POLICY_MODES.includes(mode)) {
      errors.push(`writes.policy["${tool}"]: mode must be one of ${WRITE_POLICY_MODES.join(', ')}, got "${mode}"`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Resolve the configured policy mode for a specific governed write. Reads
 * `config.writes.policy["<providerId>.<writeKind>"]`; anything absent,
 * unrecognized, or malformed resolves to the fail-safe default.
 *
 * @param {string} providerId
 * @param {string} writeKind
 * @param {object} [config] - a loaded construct.config.json
 * @returns {'auto'|'approval'|'deny'}
 */
export function resolveWritePolicy(providerId, writeKind, config) {
  const tool = `${providerId}.${writeKind}`;
  const configured = config?.writes?.policy?.[tool];
  return WRITE_POLICY_MODES.includes(configured) ? configured : DEFAULT_WRITE_POLICY_MODE;
}
