/**
 * lib/templates/visual-requirements.mjs — required visuals and structure per document type.
 *
 * Loads structure and visual requirements from specialists/artifact-manifest.json
 * (single source of truth) and merges legacy types not yet in the manifest.
 * Paired with docs/guides/concepts/doc-visual-matrix.md; pinned by template tests.
 */

import { readFileSync } from 'node:fs';
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

function hasMarkdownHeading(body, titles) {
  const targets = new Set(titles.map((title) => title.trim().toLowerCase()));
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let match;
  while ((match = headingRe.exec(body))) {
    if (targets.has(match[1].trim().toLowerCase())) return true;
  }
  return false;
}

export function lintPrdDeliveryDepth(body) {
  const errors = [];
  const hasRequirements = hasMarkdownHeading(body, ['Requirements', 'Functional requirements'])
    || /\*\*FR-\d+\.\d+\*\*:|\bFR-\d+\.\d+:/.test(body);
  if (!hasRequirements) {
    errors.push('prd missing functional requirements (## Requirements or FR-* entries)');
  }
  const hasAcceptance = hasMarkdownHeading(body, ['Acceptance criteria', 'Acceptance'])
    || /\*Acceptance(\*:|:\*)|\*\*Acceptance\*\*:/i.test(body);
  if (!hasAcceptance) {
    errors.push('prd missing acceptance criteria (## Acceptance criteria or *Acceptance* / *Acceptance:* markers)');
  }
  return errors;
}

export function lintDocStructure(filePath, type) {
  const sectionChecks = (STRUCTURE_REQUIREMENTS[type] || []).map((section) => ({
    id: `${type}-section-${section}`,
    check: 'artifact-has-section',
    section,
  }));
  const postconditions = [...sectionChecks, ...(VISUAL_REQUIREMENTS[type] || [])];
  let errors = postconditions.length === 0
    ? []
    : validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
  if (type === 'prd') {
    const raw = readFileSync(filePath, 'utf8');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    errors = [...errors, ...lintPrdDeliveryDepth(body)];
  }
  return errors;
}

export function lintDocVisuals(filePath, type) {
  const postconditions = VISUAL_REQUIREMENTS[type];
  if (!postconditions) return [];
  return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
}
