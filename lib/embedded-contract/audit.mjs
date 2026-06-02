/**
 * lib/embedded-contract/audit.mjs — approval gating and provenance identity for the ECL.
 *
 * Read-only contracts (capability, triage, model resolution) never write. The
 * workflow-invocation contract is the only surface that can mutate durable
 * state, and only when its approval mode permits. This module is the single
 * place that maps an approval mode plus the deployment mode to a write gate, so
 * the rule "no unapproved writes, mandatory audit on team/enterprise writes"
 * lives in one tested function rather than scattered across call sites.
 *
 * The provenance sink for durable writes (the hash-chained audit trail) is wired
 * by the workflow-invocation surface where writes actually occur and can be
 * asserted against a real trail; this module owns the identity (traceId) and the
 * gate decision.
 */

import { randomUUID } from 'node:crypto';

export const APPROVAL_MODES = ['proposal-only', 'requires-human-approval', 'allow-durable-write'];
export const DEFAULT_APPROVAL_MODE = 'proposal-only';

export function isValidApprovalMode(mode) {
  return typeof mode === 'string' && APPROVAL_MODES.includes(mode);
}

/**
 * Mint a trace identifier for one contract invocation. Carried in workflow
 * responses so an embedder can correlate the call with downstream provenance.
 *
 * @returns {string}
 */
export function newTraceId() {
  return `ecl-${randomUUID()}`;
}

/**
 * Resolve whether durable writes are permitted for an invocation, whether the
 * caller must collect human approval first, and whether the write must be
 * audited. Unknown modes fall back to the safest mode (proposal-only).
 *
 * @param {object} opts
 * @param {string} [opts.approvalMode]
 * @param {string} [opts.deploymentMode]
 * @returns {{approvalMode:string,allowWrites:boolean,requiresApproval:boolean,mandatoryAudit:boolean}}
 */
export function resolveWriteGate({ approvalMode = DEFAULT_APPROVAL_MODE, deploymentMode = 'solo' } = {}) {
  const mode = isValidApprovalMode(approvalMode) ? approvalMode : DEFAULT_APPROVAL_MODE;
  const allowWrites = mode === 'allow-durable-write';
  const requiresApproval = mode === 'requires-human-approval';
  const mandatoryAudit = allowWrites && (deploymentMode === 'team' || deploymentMode === 'enterprise');
  return { approvalMode: mode, allowWrites, requiresApproval, mandatoryAudit };
}
