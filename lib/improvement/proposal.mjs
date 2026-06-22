/**
 * lib/improvement/proposal.mjs — the improvement-loop proposal record and its
 * operator state machine (construct-6zga.1.5).
 *
 * Every candidate change in the governed loop is a proposal, never an applied
 * mutation. A proposal declares its type, the affected profiles, the blast radius,
 * a rollback target, the gates to pass, an approver, and a rollout mode, plus
 * immutable lineage — input-trace references, baseline/candidate versions, the
 * capability snapshot, evaluator versions, and budgets — so a reader can re-verify
 * its provenance. The operator state machine encodes the only legal progressions
 * (observed through applied/rolled_back), so a proposal can never jump the held-out
 * evaluation or the approval boundary by skipping a state.
 * Reference shape: schemas/improvement-proposal.schema.json.
 */

export const IMPROVEMENT_PROPOSAL_SCHEMA_VERSION = 1;

export const PROPOSAL_TYPES = Object.freeze([
  'prompt',
  'role-flavor',
  'skill',
  'routing-rule',
  'contract',
  'provider-adapter',
  'policy-config',
]);

export const PROPOSAL_STATES = Object.freeze([
  'observed',
  'rejected',
  'reproduce_failed',
  'baseline_failed',
  'proposal_ready',
  'evaluation_failed',
  'awaiting_approval',
  'approved',
  'applied',
  'rolled_back',
  'superseded',
]);

export const BLAST_RADIUS = Object.freeze(['single-surface', 'multi-surface', 'global']);
export const ROLLOUT_MODES = Object.freeze(['sandbox', 'staged', 'monitored']);

// The only legal state progressions. superseded is reachable from any non-terminal
// state (a newer proposal replaces this one); the terminal states have no
// successor. Nothing reaches applied without passing through approved, and nothing
// reaches approved without awaiting_approval — the held-out evaluation and the
// human approval boundary cannot be skipped.

const LEGAL_TRANSITIONS = Object.freeze({
  observed: Object.freeze(['reproduce_failed', 'proposal_ready', 'rejected', 'superseded']),
  proposal_ready: Object.freeze(['baseline_failed', 'evaluation_failed', 'awaiting_approval', 'superseded']),
  awaiting_approval: Object.freeze(['approved', 'rejected', 'superseded']),
  approved: Object.freeze(['applied', 'superseded']),
  applied: Object.freeze(['rolled_back', 'superseded']),
  rejected: Object.freeze([]),
  reproduce_failed: Object.freeze([]),
  baseline_failed: Object.freeze([]),
  evaluation_failed: Object.freeze([]),
  rolled_back: Object.freeze([]),
  superseded: Object.freeze([]),
});

export function isTerminalState(state) {
  return Array.isArray(LEGAL_TRANSITIONS[state]) && LEGAL_TRANSITIONS[state].length === 0;
}

export function canTransition(from, to) {
  return Array.isArray(LEGAL_TRANSITIONS[from]) && LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Advance a proposal to a new state, merging an optional patch. Returns
 * { ok, proposal } on a legal transition or { ok: false, error } otherwise, so the
 * controller can refuse rather than throw on an illegal progression.
 */
export function transitionProposal(proposal, to, patch = {}) {
  const from = proposal?.state;
  if (!PROPOSAL_STATES.includes(to)) return { ok: false, error: `unknown target state: ${to}` };
  if (!canTransition(from, to)) return { ok: false, error: `illegal transition: ${from} -> ${to}` };
  return { ok: true, proposal: { ...proposal, ...patch, state: to } };
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Returns { valid, errors } against schemas/improvement-proposal.schema.json.
 */
export function validateProposal(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') return { valid: false, errors: ['proposal is not an object'] };
  if (proposal.schemaVersion !== IMPROVEMENT_PROPOSAL_SCHEMA_VERSION) errors.push(`schemaVersion must be ${IMPROVEMENT_PROPOSAL_SCHEMA_VERSION}`);
  if (typeof proposal.id !== 'string' || !proposal.id) errors.push('id required');
  if (!PROPOSAL_TYPES.includes(proposal.type)) errors.push(`type invalid: ${proposal.type}`);
  if (!PROPOSAL_STATES.includes(proposal.state)) errors.push(`state invalid: ${proposal.state}`);
  if (!Array.isArray(proposal.affectedProfiles)) errors.push('affectedProfiles must be an array');
  if (!BLAST_RADIUS.includes(proposal.blastRadius)) errors.push(`blastRadius invalid: ${proposal.blastRadius}`);
  if (!proposal.rollbackTarget || typeof proposal.rollbackTarget !== 'object' || typeof proposal.rollbackTarget.version !== 'string') {
    errors.push('rollbackTarget.version required');
  }
  if (!Array.isArray(proposal.requiredGates)) errors.push('requiredGates must be an array');
  if (!ROLLOUT_MODES.includes(proposal.rolloutMode)) errors.push(`rolloutMode invalid: ${proposal.rolloutMode}`);

  const lineage = proposal.lineage;
  if (!lineage || typeof lineage !== 'object') errors.push('lineage missing');
  else {
    if (!Array.isArray(lineage.inputTraceIds)) errors.push('lineage.inputTraceIds must be an array');
    if (typeof lineage.baselineVersion !== 'string') errors.push('lineage.baselineVersion required');
    if (typeof lineage.candidateVersion !== 'string') errors.push('lineage.candidateVersion required');
    if (!lineage.capabilitySnapshot || typeof lineage.capabilitySnapshot !== 'object') errors.push('lineage.capabilitySnapshot required');
    if (!Array.isArray(lineage.evaluatorVersions)) errors.push('lineage.evaluatorVersions must be an array');
  }

  const approver = proposal.approver;
  if (approver !== null && (typeof approver !== 'object' || typeof approver.identity !== 'string')) {
    errors.push('approver must be null or carry an identity');
  }

  return { valid: errors.length === 0, errors };
}
