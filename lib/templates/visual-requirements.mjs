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
