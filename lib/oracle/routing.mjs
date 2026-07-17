/**
 * lib/oracle/routing.mjs — deterministic gap → specialist routing table.
 *
 * Mirrors skills/operating/fleet-health-routing.md (the fleet-health duty
 * cx-oracle's retirement folded into cx-orchestrator, construct-rf26.11)
 * without LLM involvement. Issue raising, approve execution, and routing
 * artifact generation consume these mappings. Specialist ids reflect the
 * post-consolidation 12-role roster; team-governance signals route to
 * cx-operations (owns dependency/ownership mapping) rather than the retired
 * cx-rd-lead.
 */

const GAP_ROUTES = {
  'parity-drift': { primary: 'cx-engineer', secondary: 'cx-operations' },
  'contract-violations': { primary: 'cx-reviewer', secondary: 'cx-engineer' },
  'doctor-escalation': { primary: 'cx-operations', secondary: 'cx-operations' },
  'outcomes-degradation': { primary: 'cx-reviewer', secondary: null },
  'census-stale': { primary: 'cx-architect', secondary: 'cx-operations' },
  'alignment-regression': { primary: 'cx-architect', secondary: 'cx-operations' },
  'true-skill-orphan': { primary: 'cx-architect', secondary: 'cx-operations' },
  'observations-empty': { primary: 'cx-researcher', secondary: 'cx-engineer' },
  'beads-hygiene': { primary: 'cx-operations', secondary: null },
  'hook-failures': { primary: 'cx-operations', secondary: null },
  'registry-warn': { primary: 'cx-engineer', secondary: null },
  'consistency-drift': { primary: 'cx-engineer', secondary: null },
  'propagation-stale': { primary: 'cx-engineer', secondary: 'cx-operations' },
  'policy-coverage-gap': { primary: 'cx-architect', secondary: null },
  'workflow-misaligned': { primary: 'cx-product-manager', secondary: null },
  'legal-review-pending': { primary: 'cx-security', secondary: null },
  'capability-unvalidated': { primary: 'cx-engineer', secondary: null },
  'dead-code-regression': { primary: 'cx-architect', secondary: null },
  'structure-sprawl': { primary: 'cx-architect', secondary: null },
  'init-duplicate-lanes': { primary: 'cx-architect', secondary: null },
  'outcomes-missing': { primary: 'cx-engineer', secondary: null },
  'repo-layout-legacy': { primary: 'cx-engineer', secondary: 'cx-architect' },
  'specialist-audit-drift': { primary: 'cx-architect', secondary: 'cx-operations' },
  'artifact-gate-bypass': { primary: 'cx-reviewer', secondary: 'cx-operations' },
  'artifact-reviewer-gap': { primary: 'cx-reviewer', secondary: null },
  'dependency-graph-stale': { primary: 'cx-engineer', secondary: null },
  'matrix-coverage-gap': { primary: 'cx-architect', secondary: 'cx-qa' },
  'impact-untested': { primary: 'cx-qa', secondary: 'cx-engineer' },
  // Team governance signals — rd-lead retired (construct-rf26.11); route to
  // cx-operations (owns dependency/ownership mapping) for resolution.
  'team-understaffed': { primary: 'cx-operations', secondary: 'cx-orchestrator' },
  'escalation-path-broken': { primary: 'cx-operations', secondary: 'cx-architect' },
  'team-decision-violation': { primary: 'cx-operations', secondary: 'cx-orchestrator' },
  'cross-team-handoff-blocked': { primary: 'cx-operations', secondary: null },
  // A due directive's own config already names its specialist
  // (construct.config.json directives[].specialist) — this table entry only
  // supplies a sane default gateType/fallback primary for generic callers
  // that route by gap id alone; execute.mjs dispatches to the directive's
  // actual specialist directly, never through this row.
  'directive-due': { primary: 'cx-orchestrator', secondary: null },
};

const ACTION_ROUTES = {
  'specialist-review': { primary: 'cx-reviewer', gateType: 'specialist-dispatch' },
  'doctor-followup': { primary: 'cx-operations', gateType: 'operational-followup' },
  'trace-review': { primary: 'cx-reviewer', gateType: 'specialist-dispatch' },
  'outcomes-aggregate': { primary: 'cx-engineer', gateType: 'maintenance' },
  'executive-signoff-required': { primary: 'cx-product-manager', gateType: 'executive-gate' },
  'structure-cleanup-proposal': { primary: 'cx-architect', gateType: 'human-approval' },
  'graph-rebuild': { primary: 'cx-engineer', gateType: 'maintenance' },
  'directive-due': { primary: 'cx-orchestrator', gateType: 'human-approval' },
};

/**
 * @param {{ id?: string, signal?: string }} gap
 * @returns {{ primary: string, secondary: string|null, gateType?: string }}
 */
export function routeGap(gap) {
  const id = gap?.id ?? gap?.signal ?? '';
  const row = GAP_ROUTES[id];
  if (row) return { ...row, gateType: signOffGateForGap(id) };
  return { primary: 'cx-orchestrator', secondary: null, gateType: 'human-approval' };
}

/**
 * @param {string} actionKind
 */
export function routeAction(actionKind) {
  return ACTION_ROUTES[actionKind] ?? { primary: 'cx-orchestrator', gateType: 'human-approval' };
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
