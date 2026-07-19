/**
 * lib/oracle/routing.mjs — deterministic gap → Worker Profile routing table.
 *
 * Mirrors skills/operating/fleet-health-routing.md (the fleet-health duty
 * cx-oracle's retirement folded into orchestrator, construct-rf26.11)
 * without LLM involvement. Issue raising, approve execution, and routing
 * artifact generation consume these mappings. Every route names Worker
 * Profiles and the governing Policy explicitly; execution topology is
 * represented later as Assignments.
 */

const GAP_ROUTES = {
  'parity-drift': { workerProfileId: 'engineer', fallbackWorkerProfileId: 'operations' },
  'contract-violations': { workerProfileId: 'reviewer', fallbackWorkerProfileId: 'engineer' },
  'doctor-escalation': { workerProfileId: 'operations', fallbackWorkerProfileId: null },
  'outcomes-degradation': { workerProfileId: 'reviewer', fallbackWorkerProfileId: null },
  'census-stale': { workerProfileId: 'architect', fallbackWorkerProfileId: 'operations' },
  'alignment-regression': { workerProfileId: 'architect', fallbackWorkerProfileId: 'operations' },
  'true-skill-orphan': { workerProfileId: 'architect', fallbackWorkerProfileId: 'operations' },
  'observations-empty': { workerProfileId: 'researcher', fallbackWorkerProfileId: 'engineer' },
  'beads-hygiene': { workerProfileId: 'operations', fallbackWorkerProfileId: null },
  'hook-failures': { workerProfileId: 'operations', fallbackWorkerProfileId: null },
  'registry-warn': { workerProfileId: 'engineer', fallbackWorkerProfileId: null },
  'consistency-drift': { workerProfileId: 'engineer', fallbackWorkerProfileId: null },
  'propagation-stale': { workerProfileId: 'engineer', fallbackWorkerProfileId: 'operations' },
  'policy-coverage-gap': { workerProfileId: 'architect', fallbackWorkerProfileId: null },
  'workflow-misaligned': { workerProfileId: 'product-manager', fallbackWorkerProfileId: null },
  'legal-review-pending': { workerProfileId: 'security', fallbackWorkerProfileId: null },
  'capability-unvalidated': { workerProfileId: 'engineer', fallbackWorkerProfileId: null },
  'dead-code-regression': { workerProfileId: 'architect', fallbackWorkerProfileId: null },
  'structure-sprawl': { workerProfileId: 'architect', fallbackWorkerProfileId: null },
  'init-duplicate-lanes': { workerProfileId: 'architect', fallbackWorkerProfileId: null },
  'outcomes-missing': { workerProfileId: 'engineer', fallbackWorkerProfileId: null },
  'repo-layout-legacy': { workerProfileId: 'engineer', fallbackWorkerProfileId: 'architect' },
  'worker-profile-audit-drift': { workerProfileId: 'architect', fallbackWorkerProfileId: 'operations' },
  'artifact-gate-bypass': { workerProfileId: 'reviewer', fallbackWorkerProfileId: 'operations' },
  'artifact-reviewer-gap': { workerProfileId: 'reviewer', fallbackWorkerProfileId: null },
  'dependency-graph-stale': { workerProfileId: 'engineer', fallbackWorkerProfileId: null },
  'matrix-coverage-gap': { workerProfileId: 'architect', fallbackWorkerProfileId: 'qa' },
  'impact-untested': { workerProfileId: 'qa', fallbackWorkerProfileId: 'engineer' },
  // A due directive carries its selected Worker Profile on the resulting
  // action; this row supplies the generic route used by other callers.
  'directive-due': { workerProfileId: 'orchestrator', fallbackWorkerProfileId: null },
};

const ACTION_ROUTES = {
  'worker-profile-review': { workerProfileId: 'reviewer', policyId: 'agents-routing' },
  'doctor-followup': { workerProfileId: 'operations', policyId: 'incident-response' },
  'trace-review': { workerProfileId: 'reviewer', policyId: 'agents-routing' },
  'outcomes-aggregate': { workerProfileId: 'engineer', policyId: 'action-approval' },
  'executive-signoff-required': { workerProfileId: 'product-manager', policyId: 'strategic-prioritization' },
  'structure-cleanup-proposal': { workerProfileId: 'architect', policyId: 'action-approval' },
  'graph-rebuild': { workerProfileId: 'engineer', policyId: 'action-approval' },
  'directive-due': { workerProfileId: 'orchestrator', policyId: 'action-approval' },
};

/**
 * @param {{ id?: string, signal?: string }} gap
 * @returns {{ workerProfileId: string, fallbackWorkerProfileId: string|null, policyId: string }}
 */
export function routeGap(gap) {
  const id = gap?.id ?? gap?.signal ?? '';
  const row = GAP_ROUTES[id];
  if (row) return { ...row, policyId: policyForGap(id) };
  return { workerProfileId: 'orchestrator', fallbackWorkerProfileId: null, policyId: 'action-approval' };
}

/**
 * @param {string} actionKind
 */
export function routeAction(actionKind) {
  return ACTION_ROUTES[actionKind] ?? { workerProfileId: 'orchestrator', policyId: 'action-approval' };
}

function policyForGap(gapId) {
  if (gapId === 'legal-review-pending') return 'security-approval';
  if (gapId === 'workflow-misaligned') return 'strategic-prioritization';
  if (gapId === 'impact-untested') return 'quality-gate-approval';
  return 'agents-routing';
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
    policyId: route.policyId,
    approverWorkerProfileId: route.workerProfileId,
    artifactPath: `.construct/oracle/verdicts/`,
    projectDir,
  };
}
