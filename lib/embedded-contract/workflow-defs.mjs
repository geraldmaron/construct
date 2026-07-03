/**
 * lib/embedded-contract/workflow-defs.mjs — embedded workflow type definitions.
 *
 * Generated/compat shim (LMCP-D2) — this module has no hand-authored catalog.
 * DEFS is computed at import time exclusively from lib/workflows/loader.mjs
 * (LMCP-D1), which reads builtin/pack/project *.manifest.json files. Editing a
 * workflow means editing a manifest under lib/embedded-contract/workflows/ (or a
 * pack/.cx manifest); this file cannot silently drift from them because it does
 * not store data of its own. scripts/check-workflow-defs-drift.mjs enforces that
 * invariant in CI — it fails if the source regains a hardcoded catalog entry or
 * loses the loader import.
 *
 * The single source of truth for the workflow types an embedding application can
 * invoke. Each definition names a default role chain (real registry role ids), a
 * model tier, a default approval mode, an optional output-schema artifact, and a
 * one-line description. Skills are not hardcoded here — they are derived from the
 * selected roles' declared skills (role-facts) so this file never names a skill
 * id that does not exist. Capability discovery reads these definitions so the
 * published workflow list cannot drift from what invocation actually supports.
 *
 * INTAKE_TO_WORKFLOW is the one hand-authored table left: no manifest field
 * currently declares a classifier intakeType, so the triage bridge mapping stays
 * source-level until a manifest schema field exists for it.
 */

import { loadAllWorkflows } from '../workflows/loader.mjs';

const { workflows } = loadAllWorkflows();

// Embed manifests are a workflow-manifest specialization (an embed capability,
// discovered by the embed-capability loader) — they carry an embed block, no
// executable role chain — so they are excluded from the invokable workflow-type
// catalog rather than surfaced as a chain-less workflow.
const DEFS = {};
for (const wf of workflows) {
  if (wf.type === 'embed') continue;
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