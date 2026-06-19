/**
 * lib/oracle/routing.mjs — deterministic gap → specialist routing table.
 *
 * Mirrors cx-oracle.md routing without LLM involvement. Issue raising,
 * approve execution, and routing artifact generation consume these mappings.
 */

const GAP_ROUTES = {
  'parity-drift': { primary: 'cx-platform-engineer', secondary: 'cx-docs-keeper' },
  'contract-violations': { primary: 'cx-reviewer', secondary: 'cx-engineer' },
  'doctor-escalation': { primary: 'cx-sre', secondary: 'cx-operations' },
  'outcomes-degradation': { primary: 'cx-trace-reviewer', secondary: null },
  'census-stale': { primary: 'cx-architect', secondary: 'cx-docs-keeper' },
  'alignment-regression': { primary: 'cx-architect', secondary: 'cx-docs-keeper' },
  'true-skill-orphan': { primary: 'cx-architect', secondary: 'cx-docs-keeper' },
  'observations-empty': { primary: 'cx-explorer', secondary: 'cx-data-engineer' },
  'beads-hygiene': { primary: 'cx-operations', secondary: null },
  'hook-failures': { primary: 'cx-sre', secondary: null },
  'registry-warn': { primary: 'cx-platform-engineer', secondary: null },
  'consistency-drift': { primary: 'cx-platform-engineer', secondary: null },
  'propagation-stale': { primary: 'cx-platform-engineer', secondary: 'cx-docs-keeper' },
  'policy-coverage-gap': { primary: 'cx-architect', secondary: null },
  'workflow-misaligned': { primary: 'cx-product-manager', secondary: null },
  'legal-review-pending': { primary: 'cx-legal-compliance', secondary: null },
  'capability-unvalidated': { primary: 'cx-platform-engineer', secondary: null },
  'dead-code-regression': { primary: 'cx-architect', secondary: null },
  'structure-sprawl': { primary: 'cx-architect', secondary: null },
  'init-duplicate-lanes': { primary: 'cx-architect', secondary: null },
};

const ACTION_ROUTES = {
  'specialist-review': { primary: 'cx-reviewer', gateType: 'specialist-dispatch' },
  'doctor-followup': { primary: 'cx-sre', gateType: 'operational-followup' },
  'trace-review': { primary: 'cx-trace-reviewer', gateType: 'specialist-dispatch' },
  'outcomes-aggregate': { primary: 'cx-data-engineer', gateType: 'maintenance' },
  'executive-signoff-required': { primary: 'cx-product-manager', gateType: 'executive-gate' },
  'structure-cleanup-proposal': { primary: 'cx-architect', gateType: 'human-approval' },
};

/**
 * @param {{ id?: string, signal?: string }} gap
 * @returns {{ primary: string, secondary: string|null, gateType?: string }}
 */
export function routeGap(gap) {
  const id = gap?.id ?? gap?.signal ?? '';
  const row = GAP_ROUTES[id];
  if (row) return { ...row, gateType: signOffGateForGap(id) };
  return { primary: 'cx-oracle', secondary: null, gateType: 'human-approval' };
}

/**
 * @param {string} actionKind
 */
export function routeAction(actionKind) {
  return ACTION_ROUTES[actionKind] ?? { primary: 'cx-oracle', gateType: 'human-approval' };
}

function signOffGateForGap(gapId) {
  if (gapId === 'legal-review-pending') return 'legal-compliance';
  if (gapId === 'workflow-misaligned') return 'executive-gate';
  if (gapId === 'capability-unvalidated') return 'capability-human-gate';
  if (gapId === 'structure-sprawl' || gapId === 'dead-code-regression') return 'human-approval';
  return null;
}

/**
 * Sign-off metadata attached to approve actions and high-severity gaps.
 *
 * @param {{ id: string, severity?: string }} gap
 * @param {string} projectDir
 */
export function signOffMetadata(gap, projectDir) {
  const route = routeGap(gap);
  return {
    gateType: route.gateType ?? 'human-approval',
    requiredApprover: route.primary,
    artifactPath: `.cx/oracle/verdicts/`,
    projectDir,
  };
}
