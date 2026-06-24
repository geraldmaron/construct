/**
 * lib/templates/visual-requirements.mjs — required visuals and structure per document type.
 *
 * Loads structure and visual requirements from specialists/artifact-manifest.json
 * (single source of truth) and merges legacy types not yet in the manifest.
 * Paired with docs/guides/concepts/doc-visual-matrix.md; pinned by template tests.
 */

import { validateArtifactPostconditions } from '../contracts/validate.mjs';
import {
  structureRequirementsFromManifest,
  visualRequirementsFromManifest,
  getArtifactEntry,
} from '../artifact-manifest.mjs';

const LEGACY_STRUCTURE = {
  'persona-artifact': ['Goals', 'Frustrations', 'Decision rights', 'Output contract', 'Failure modes', 'Evidence'],
  'skill-artifact': ['What this skill produces', 'When to invoke it', 'Competency rubric', 'Failure modes', 'Worked example'],
  'research-finding': ['SOURCES', 'FINDINGS', 'INFERENCES', 'CONFIDENCE', 'GAPS', 'RECOMMENDATION'],
};

export const STRUCTURE_REQUIREMENTS = {
  ...structureRequirementsFromManifest(),
  ...LEGACY_STRUCTURE,
};

export const VISUAL_REQUIREMENTS = {
  ...visualRequirementsFromManifest(),
};

export function visualRequirementTypes() {
  return Object.keys(VISUAL_REQUIREMENTS);
}

export function structureRequirementTypes() {
  return [...new Set([...Object.keys(STRUCTURE_REQUIREMENTS), ...Object.keys(VISUAL_REQUIREMENTS)])];
}

export function resolveTemplatePath(type, rootDir) {
  const entry = getArtifactEntry(type, { rootDir });
  if (entry?.template) return entry.template;
  return `templates/docs/${type}.md`;
}

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

export function lintDocVisuals(filePath, type) {
  const postconditions = VISUAL_REQUIREMENTS[type];
  if (!postconditions) return [];
  return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
}
