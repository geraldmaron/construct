/**
 * lib/embedded-contract/workflow-defs.mjs — embedded workflow type definitions.
 *
 * The single source of truth for the workflow types an embedding application can
 * invoke. Each definition names a default role chain (real registry role ids), a
 * model tier, a default approval mode, an optional output-schema artifact, and a
 * one-line description. Skills are not hardcoded here — they are derived from the
 * selected roles' declared skills (role-facts) so this file never names a skill
 * id that does not exist. Capability discovery reads these definitions so the
 * published workflow list cannot drift from what invocation actually supports.
 */

const DEFS = {
  'evidence-ingest': {
    tier: 'fast',
    defaultApprovalMode: 'proposal-only',
    chain: ['researcher', 'data-analyst'],
    outputSchema: null,
    description: 'Ingest and structure raw evidence (notes, documents, signals) into a normalized summary.',
  },
  'proposal-review': {
    tier: 'standard',
    defaultApprovalMode: 'requires-human-approval',
    chain: ['reviewer', 'devil-advocate'],
    outputSchema: 'review-report',
    description: 'Review a proposal for correctness, risk, and hidden assumptions before acceptance.',
  },
  'prd-draft': {
    tier: 'standard',
    defaultApprovalMode: 'proposal-only',
    chain: ['product-manager', 'architect'],
    outputSchema: 'decision',
    description: 'Draft a product requirements document from a problem statement and supporting evidence.',
  },
  'architecture-review': {
    tier: 'reasoning',
    defaultApprovalMode: 'requires-human-approval',
    chain: ['architect', 'security', 'devil-advocate'],
    outputSchema: 'review-report',
    description: 'Review an architecture or design for trade-offs, failure modes, and security exposure.',
  },
  'risk-review': {
    tier: 'reasoning',
    defaultApprovalMode: 'requires-human-approval',
    chain: ['devil-advocate', 'security', 'legal-compliance'],
    outputSchema: 'review-report',
    description: 'Stress-test a plan for risk: failure modes, security, and compliance exposure.',
  },
  'research-synthesis': {
    tier: 'reasoning',
    defaultApprovalMode: 'proposal-only',
    chain: ['researcher', 'data-analyst', 'evaluator'],
    outputSchema: null,
    description: 'Synthesize multiple sources into a cited, evidence-graded research summary.',
  },
  'transcript-process': {
    tier: 'fast',
    defaultApprovalMode: 'proposal-only',
    chain: ['researcher', 'data-analyst'],
    outputSchema: null,
    description: 'Process a meeting/call transcript into a summary, decisions, and action items.',
  },
  'data-structure': {
    tier: 'standard',
    defaultApprovalMode: 'proposal-only',
    chain: ['data-analyst', 'data-engineer'],
    outputSchema: null,
    description: 'Parse, validate, and profile a raw dataset into a structured, described shape.',
  },
  'memo-draft': {
    tier: 'fast',
    defaultApprovalMode: 'proposal-only',
    chain: ['docs-keeper', 'reviewer'],
    outputSchema: null,
    description: 'Draft a decision or status memo from a problem statement and context.',
  },
  'structure-notes': {
    tier: 'fast',
    defaultApprovalMode: 'proposal-only',
    chain: ['orchestrator', 'researcher'],
    outputSchema: null,
    description: 'Structure an unclassified brain-dump or rough notes into a normalized summary with extracted intents.',
  },
};

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
  return WORKFLOW_TYPES.map((type) => ({ type, ...DEFS[type] }));
}

export function workflowTypeForIntake(intakeType) {
  return INTAKE_TO_WORKFLOW[intakeType] || null;
}
