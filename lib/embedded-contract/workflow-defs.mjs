/**
 * lib/embedded-contract/workflow-defs.mjs — embedded workflow type definitions.
 *
 * Generated/compat shim — reads from workflow manifests per ADR-0054.
 * Will be replaced in LMCP-D2 with direct manifest consumption.
 *
 * The single source of truth for the workflow types an embedding application can
 * invoke. Each definition names a default role chain (real registry role ids), a
 * model tier, a default approval mode, an optional output-schema artifact, and a
 * one-line description. Skills are not hardcoded here — they are derived from the
 * selected roles' declared skills (role-facts) so this file never names a skill
 * id that does not exist. Capability discovery reads these definitions so the
 * published workflow list cannot drift from what invocation actually supports.
 */

import { loadAllWorkflows } from '../workflows/loader.mjs';

const { workflows } = loadAllWorkflows();

const DEFS = {};
for (const wf of workflows) {
  DEFS[wf.id] = {
    tier: wf.tier || 'standard',
    defaultApprovalMode: wf.defaultApprovalMode,
    chain: wf.roleChain || [],
    outputSchema: null,
    description: wf.description || '',
  };
  if (wf.outputSchema?.artifact) {
    DEFS[wf.id].outputSchema = wf.outputSchema.artifact;
  }
}

// Maps a classifier intakeType to the workflow type that would carry it out, so
// the triage contract can suggest a directly-invokable workflow. Returns null
// when no workflow covers the classification (the plan is not directly invokable).

const INTAKE_TO_WORKFLOW = {
  proposal: 'proposal-review',
  prd: 'prd-draft',
  'meta-prd': 'prd-draft',
  architecture: 'architecture-review',
  rfc: 'architecture-review',
  risk: 'risk-review',
  security: 'risk-review',
  research: 'research-synthesis',
  'research-note': 'research-synthesis',
  signal: 'evidence-ingest',
  'user-signal': 'evidence-ingest',
  evidence: 'evidence-ingest',
  memo: 'memo-draft',
  transcript: 'transcript-process',
  'raw-data': 'data-structure',
  unknown: 'structure-notes',
};

export const WORKFLOW_TYPES = Object.keys(DEFS);

export function getWorkflowDef(type) {
  return DEFS[type] || null;
}

/**
 * Public, secret-free description of every workflow type for capability discovery.
 * @returns {Array<object>}
 */
export function listWorkflowDefs() {
  return Object.entries(DEFS).map(([type, def]) => ({ type, ...def }));
}

export function workflowTypeForIntake(intakeType) {
  return INTAKE_TO_WORKFLOW[intakeType] || null;
}