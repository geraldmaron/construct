/**
 * lib/specialists/postconditions.mjs — hard binary postconditions per producer persona.
 *
 * `specialists/contracts.json` carries free-text postconditions for documentation
 * purposes. This module adds binary, programmatically-validated assertions
 * that the persona's output packet must satisfy before a handoff is allowed
 * to proceed. Failure throws `ContractViolationError` with reason
 * `BLOCKED_CONTRACT` so the dispatcher refuses to forward a packet that
 * silently rubber-stamps, fixes symptoms without root cause, ships stale
 * docs, or skips accessibility review.
 *
 * Each rule is identified by a stable id so violations are greppable in
 * `~/.cx/contract-violations.jsonl`. Rules are pure functions of the
 * output packet — no IO, no LLM calls — so they're deterministic and
 * cheap to evaluate.
 *
 * Producers covered (CF3 round 1 from the 2026-05-13 UX audit):
 *   - cx-reviewer       prevents silent rubber-stamp reviews
 *   - cx-security       prevents post-hoc threat models
 *   - cx-debugger       prevents symptom-only fixes
 *   - cx-docs-keeper    prevents stale-doc PRs
 *   - cx-designer       prevents post-hoc accessibility
 */

const ROOT_CAUSE_SOURCES = new Set(['reproduction', 'trace', 'test']);

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLaterOrEqual(a, b) {
  const ta = a instanceof Date ? a.getTime() : Date.parse(a);
  const tb = b instanceof Date ? b.getTime() : Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta >= tb;
}

/**
 * Rule table. Keyed by producer name (matching specialists/registry.json).
 * Each rule:
 *   id          — stable identifier for violation logs
 *   description — single-line documentation
 *   check       — (packet) => boolean — true when satisfied
 *   reason      — explanation surfaced when violated
 */
export const POSTCONDITIONS = {
  'cx-reviewer': [
    {
      id: 'reviewer.findings-or-explicit-clear',
      description: 'Reviewer must either return at least one finding or explicitly state "no issues found at: <paths>".',
      check: (p) => isNonEmptyArray(p?.findings) || isNonEmptyArray(p?.noIssuesFoundAt) || isNonEmptyString(p?.noIssuesFoundStatement),
      reason: 'Reviewer output rubber-stamped: empty findings and no explicit "no issues found at: <paths>" statement.',
    },
  ],
  'cx-security': [
    {
      id: 'security.threat-model-not-post-hoc',
      description: 'Threat model must be updated at or after the contract start (not retrofitted).',
      check: (p) => {
        if (!p?.threatModelUpdatedAt || !p?.contractStart) return false;
        return isLaterOrEqual(p.threatModelUpdatedAt, p.contractStart);
      },
      reason: 'Threat model missing or older than the contract start — likely retrofitted after implementation.',
    },
  ],
  'cx-debugger': [
    {
      id: 'debugger.root-cause-confirmed-via',
      description: 'Root cause must be confirmed via reproduction, trace, or test (not inferred).',
      check: (p) => typeof p?.rootCauseConfirmedVia === 'string' && ROOT_CAUSE_SOURCES.has(p.rootCauseConfirmedVia),
      reason: `rootCauseConfirmedVia must be one of: ${[...ROOT_CAUSE_SOURCES].join(', ')}.`,
    },
  ],
  'cx-docs-keeper': [
    {
      id: 'docs-keeper.cross-doc-coherence-check-ran',
      description: 'Docs-keeper must run the cross-doc coherence check and attach a named diff.',
      check: (p) => p?.crossDocCoherenceCheckRan === true && isNonEmptyString(p?.coherenceDiff),
      reason: 'crossDocCoherenceCheckRan must be true AND coherenceDiff must be a non-empty named diff.',
    },
  ],
  'cx-designer': [
    {
      id: 'designer.accessibility-check-ran',
      description: 'Designer must run the accessibility check before handoff (no post-hoc a11y).',
      check: (p) => p?.accessibilityCheckRan === true,
      reason: 'accessibilityCheckRan must be true — accessibility review is a precondition for any visual deliverable.',
    },
  ],
};

/**
 * Evaluate the binary postcondition rules for a producer's output packet.
 *
 * @param {string} producer — persona name (e.g. `cx-reviewer`)
 * @param {object} packet   — the output packet about to hand off
 * @returns {{ ok: boolean, producer: string, failures: Array<{id, reason}> }}
 */
export function validateBinaryPostconditions(producer, packet) {
  const rules = POSTCONDITIONS[producer] || [];
  if (rules.length === 0) return { ok: true, producer, failures: [] };
  const failures = [];
  for (const rule of rules) {
    let satisfied;
    try {
      satisfied = rule.check(packet);
    } catch {
      satisfied = false;
    }
    if (!satisfied) failures.push({ id: rule.id, reason: rule.reason });
  }
  return { ok: failures.length === 0, producer, failures };
}

/**
 * List the rule ids registered for a producer — useful for tests and
 * for the `agent_contract` MCP tool when surfacing what a persona must
 * produce.
 */
export function describePostconditions(producer) {
  return (POSTCONDITIONS[producer] || []).map((r) => ({ id: r.id, description: r.description }));
}
