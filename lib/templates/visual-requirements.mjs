/**
 * lib/templates/visual-requirements.mjs — required visuals per document type.
 *
 * The machine-readable form of docs/concepts/doc-visual-matrix.md: which doc
 * types must carry which visual (a diagram of a given kind, or a table with given
 * columns), expressed as postcondition checks so the existing validate.mjs engine
 * enforces them. The shipped template for each listed type must satisfy its own
 * requirements — pinned by tests/template-visuals.test.mjs — so the templates can
 * never drift out of step with the matrix (beads wvbf.10 / wvbf.11).
 */

import { validateArtifactPostconditions } from '../contracts/validate.mjs';

export const VISUAL_REQUIREMENTS = {
  runbook: [
    { id: 'runbook-diagnostic-flowchart', check: 'artifact-has-mermaid', diagram: 'flowchart' },
  ],
  'incident-report': [
    { id: 'incident-timeline-table', check: 'artifact-table-has-columns', columns: ['Time (UTC)', 'Event'] },
  ],
  rfc: [
    { id: 'rfc-sequence-diagram', check: 'artifact-has-mermaid', diagram: 'sequenceDiagram' },
  ],
};

export function visualRequirementTypes() {
  return Object.keys(VISUAL_REQUIREMENTS);
}

// The structural floor of the quality rubric (ADR-0018): the sections a domain
// expert expects for each doc type. Each shipped template must satisfy its own
// entry — pinned by tests/structure-requirements.test.mjs — so a template can
// never quietly drop a required section. Section requirements compose with the
// VISUAL_REQUIREMENTS above; lintDocStructure runs both.

export const STRUCTURE_REQUIREMENTS = {
  adr: ['Problem', 'Decision', 'Rejected alternatives', 'Consequences', 'Reversibility'],
  rfc: ['Summary', 'Motivation', 'Proposed design', 'Risks', 'Verification'],
  prd: ['Problem', 'Goals', 'Success metrics', 'Risks and mitigations'],
  'research-brief': ['Sources', 'Findings', 'Confidence summary', 'Recommendation'],
  'incident-report': ['Summary', 'Severity rationale', 'Impact', 'Timeline', 'Trigger', 'Root cause', 'Contributing factors', 'Action items'],
  runbook: ['Alert trigger', 'Symptoms', 'Impact', 'Severity and response', 'Diagnostic steps', 'Remediation', 'Rollback', 'Escalation'],
  strategy: ['Vision', 'Bets', 'Non-bets', 'North Star Metric', 'Metrics', 'Milestones', 'Risks'],
  'signal-brief': ['Signal', 'Evidence', 'Counter-signal', 'What would make this actionable'],
  prfaq: ['Problem statement', 'Press release', 'External FAQ', 'Internal FAQ', 'Evidence appendix'],
  'customer-profile': ['Snapshot', 'Active pain points', 'Open asks', 'Evidence links'],
  'one-pager': ['Problem', 'Proposal', 'Why now', 'Success measure', 'Cost', 'Asks'],
  'product-intelligence-report': ['Executive readout', 'Evidence base', 'Themes', 'Customer asks', 'Product implications', 'Recommended actions', 'Gaps and risks'],
  'backlog-proposal': ['Source evidence', 'Proposed changes', 'Duplicate and conflict check', 'Approval request'],
  'persona-artifact': ['Goals', 'Frustrations', 'Decision rights', 'Output contract', 'Failure modes', 'Evidence'],
  'skill-artifact': ['What this skill produces', 'When to invoke it', 'Competency rubric', 'Failure modes', 'Worked example'],
  'research-finding': ['SOURCES', 'FINDINGS', 'INFERENCES', 'CONFIDENCE', 'GAPS', 'RECOMMENDATION'],
};

export function structureRequirementTypes() {
  return [...new Set([...Object.keys(STRUCTURE_REQUIREMENTS), ...Object.keys(VISUAL_REQUIREMENTS)])];
}

/**
 * Lint one document against both the required sections and required visuals for
 * its type. Returns an array of violation strings (empty when satisfied or when
 * the type declares no requirements).
 */
export function lintDocStructure(filePath, type) {
  const sectionChecks = (STRUCTURE_REQUIREMENTS[type] || []).map((section) => ({
    id: `${type}-section-${section}`,
    check: 'artifact-has-section',
    section,
  }));
  const postconditions = [...sectionChecks, ...(VISUAL_REQUIREMENTS[type] || [])];
  if (postconditions.length === 0) return [];
  return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
}

/**
 * Lint one document against the visual requirements for its type. Returns an
 * array of violation strings (empty when satisfied, or when the type has no
 * declared visual requirements).
 */
export function lintDocVisuals(filePath, type) {
  const postconditions = VISUAL_REQUIREMENTS[type];
  if (!postconditions) return [];
  return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
}
