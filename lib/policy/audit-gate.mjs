/**
 * lib/policy/audit-gate.mjs — mandatory-audit enforcement for enterprise mode (LMCP-H5).
 *
 * ADR-0057 (A7): enterprise mode promises every mutating action is audited.
 * A broker/policy/write path that silently swallows an audit-sink failure
 * (as lib/mcp/broker.mjs's best-effort catch does today) makes that promise
 * false under exactly the condition it exists to cover. enforceMandatoryAudit
 * is a policy-decision precondition: in enterprise mode, when the audit sink
 * (lib/audit-trail.mjs#checkAuditSinkAvailable) is down, every action is
 * denied before any role/manifest logic runs — fail closed, no
 * CONSTRUCT_SKIP_* escape hatch. Solo and team modes never call the sink
 * check and are unaffected.
 */

import { checkAuditSinkAvailable } from '../audit-trail.mjs';

export const AUDIT_GATE_SOURCE = 'mandatory-audit-gate';

/**
 * Enterprise-only precondition: deny everything if the audit sink is down.
 * Returns null (no opinion) for solo/team or when the sink is healthy, so
 * callers can compose this before their own decision logic without changing
 * behavior outside enterprise mode.
 *
 * @param {object} input
 * @param {'solo'|'team'|'enterprise'} input.deploymentMode
 * @param {function} [input.checkSink] - injectable for tests; defaults to the real fs probe
 * @returns {{allowed: boolean, reason: string, approvalRequired: boolean, source: string}|null}
 */
export function enforceMandatoryAudit({ deploymentMode, checkSink = checkAuditSinkAvailable } = {}) {
  if (deploymentMode !== 'enterprise') return null;

  const sink = checkSink();
  if (sink.available) return null;

  return {
    allowed: false,
    reason: `enterprise mode requires a healthy audit sink; audit sink unavailable (${sink.reason || 'unknown-error'}) — action refused fail-closed`,
    approvalRequired: false,
    source: AUDIT_GATE_SOURCE,
  };
}
