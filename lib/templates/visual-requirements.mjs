/**
 * lib/templates/visual-requirements.mjs — required visuals and structure per document type.
 *
 * Loads structure and visual requirements from registry/artifact-manifest.json
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

/**
 * Shared heading presence check against a required top-level spine.
 */
export function lintRequiredSections(body, type, requiredTop) {
  const errors = [];
  const text = String(body || '');
  for (const section of requiredTop) {
    if (!hasMarkdownHeading(text, [section])) {
      errors.push(`${type} missing required section ## ${section}`);
    }
  }
  return errors;
}

/**
 * Customer / platform PRD hierarchy: Phase → Requirement (FR-p.n) → AC (AC-p.n.k).
 * Skeleton bullets without FR/AC ids fail. Templates may use nested headings
 * or an Acceptance Criteria table keyed by FR id.
 */
export function lintPrdDeliveryDepth(body, options = {}) {
  const type = options.type || 'prd';
  const requiredTop = options.requiredTop || [
    'TL;DR',
    'Background',
    'Problem',
    'Outcomes - Goals & Non-Goals',
    'Why This Matters Now',
    'Competitive Landscape & Financial Considerations',
    'Phases',
    'Requirements',
    'Acceptance Criteria',
    'Success Metrics',
    'Risks',
    'References',
  ];
  const errors = lintRequiredSections(body, type, requiredTop);
  const text = String(body || '');

  const phaseHeads = [...text.matchAll(/^###\s+Phase\s+\d+\s*:/gim)];
  if (phaseHeads.length < 1) {
    errors.push(`${type} hierarchy: need at least one ### Phase N: heading under ## Phases`);
  }

  const frIds = new Set(
    [...text.matchAll(/\bFR-(\d+)\.(\d+)\b/g)].map((m) => `FR-${m[1]}.${m[2]}`),
  );
  if (frIds.size < 1) {
    errors.push(`${type} hierarchy: need FR-<phase>.<n> requirement ids under ## Requirements`);
  }

  const acIds = new Set(
    [...text.matchAll(/\bAC-(\d+)\.(\d+)\.(\d+)\b/g)].map((m) => `AC-${m[1]}.${m[2]}.${m[3]}`),
  );
  const hasAcceptanceSection = hasMarkdownHeading(text, ['Acceptance Criteria', 'Acceptance criteria']);
  const hasInlineAcceptance = /\*Acceptance(\*:|:\*)|\*\*Acceptance\*\*:|\*\*Acceptance criteria\*\*:/i.test(text);
  if (!hasAcceptanceSection && !hasInlineAcceptance && acIds.size < 1) {
    errors.push(`${type} hierarchy: need ## Acceptance Criteria (or AC-<phase>.<n>.<k> / *Acceptance* markers)`);
  }

  for (const ac of acIds) {
    const m = /^AC-(\d+)\.(\d+)\.(\d+)$/.exec(ac);
    if (!m) continue;
    const fr = `FR-${m[1]}.${m[2]}`;
    if (!frIds.has(fr)) {
      errors.push(`${type} hierarchy: ${ac} has no matching ${fr}`);
    }
  }

  for (const fr of frIds) {
    const m = /^FR-(\d+)\.(\d+)$/.exec(fr);
    if (!m) continue;
    const phase = m[1];
    const hasPhaseRef = new RegExp(`###\\s+Phase\\s+${phase}\\s*:`, 'i').test(text)
      || new RegExp(`\\*\\*Phase\\*\\*:\\s*${phase}\\b`, 'i').test(text)
      || new RegExp(`Phase\\s+${phase}\\s+requirements`, 'i').test(text);
    if (!hasPhaseRef) {
      errors.push(`${type} hierarchy: ${fr} is not nested under Phase ${phase}`);
    }
  }

  if (frIds.size > 0 && acIds.size === 0 && !hasInlineAcceptance) {
    errors.push(`${type} hierarchy: each Requirement needs ≥1 Acceptance Criterion (AC-* or *Acceptance*)`);
  }

  return errors;
}

/**
 * Meta PRD hierarchy: Phase → MR/DR → Acceptance (*Acceptance* or AC-*).
 */
export function lintMetaPrdDeliveryDepth(body) {
  const requiredTop = [
    'TL;DR',
    'Background',
    'Problem',
    'Outcomes - Goals & Non-Goals',
    'Principles',
    'Inputs and evidence',
    'Phases',
    'Failure modes and mitigations',
    'Rollout',
    'References',
  ];
  const errors = lintRequiredSections(body, 'meta-prd', requiredTop);
  const text = String(body || '');

  const phaseHeads = [...text.matchAll(/^###\s+Phase\s+\d+\s*:/gim)];
  if (phaseHeads.length < 1) {
    errors.push('meta-prd hierarchy: need at least one ### Phase N: heading under ## Phases');
  }

  const mrIds = new Set(
    [...text.matchAll(/\bMR-(\d+)\.(\d+)\b/g)].map((m) => `MR-${m[1]}.${m[2]}`),
  );
  const drIds = new Set(
    [...text.matchAll(/\bDR-(\d+)\.(\d+)\b/g)].map((m) => `DR-${m[1]}.${m[2]}`),
  );
  if (mrIds.size < 1 && drIds.size < 1) {
    errors.push('meta-prd hierarchy: need MR-<phase>.<n> and/or DR-<phase>.<n> requirement ids');
  }

  const hasInlineAcceptance = /\*Acceptance(\*:|:\*)|\*\*Acceptance\*\*:/i.test(text);
  const acIds = [...text.matchAll(/\bAC-(?:MR|DR)?-?\d+\.\d+(?:\.\d+)?\b/gi)];
  if (!hasInlineAcceptance && acIds.length < 1) {
    errors.push('meta-prd hierarchy: each MR/DR needs *Acceptance* or AC-* markers');
  }

  return errors;
}

/**
 * Business PRD depth: falsifiable bet spine + kill criteria + adversarial risks.
 */
export function lintPrdBusinessDeliveryDepth(body) {
  const requiredTop = [
    'The bet',
    'Market thesis',
    'Problem and opportunity',
    'Strategic goals',
    'Alternatives rejected',
    'What must be true',
    'Competitive analysis',
    'Kill criteria',
    'Risks',
    'References',
  ];
  const errors = lintRequiredSections(body, 'prd-business', requiredTop);
  const text = String(body || '');
  if (!/kill criterion|kill criteria/i.test(text)) {
    errors.push('prd-business depth: Kill criteria section must name a leading indicator threshold');
  }
  if (!/adversarial|fmea/i.test(text)) {
    errors.push('prd-business depth: Risks must include an Adversarial challenge (FMEA) subsection');
  }
  if (!/alternatives rejected/i.test(text)) {
    errors.push('prd-business depth: Alternatives rejected must be present');
  }
  return errors;
}

/**
 * ADR depth: rejected alternatives + adversarial challenge required.
 */
export function lintAdrDeliveryDepth(body) {
  const requiredTop = [
    'Problem',
    'Context',
    'Decision',
    'Rationale',
    'Rejected alternatives',
    'Consequences',
    'Reversibility',
    'Adversarial challenge',
    'References',
  ];
  const errors = lintRequiredSections(body, 'adr', requiredTop);
  const text = String(body || '');
  if (!/\|.*\|/.test(text) && !/why rejected/i.test(text)) {
    errors.push('adr depth: Rejected alternatives need concrete rejection reasons');
  }
  return errors;
}

/**
 * Strategy depth: bets need kill criteria language; competitive positioning required.
 */
export function lintStrategyDeliveryDepth(body) {
  const requiredTop = [
    'Vision',
    'Bets',
    'Non-bets',
    'North Star Metric',
    'Metrics',
    'Milestones',
    'Competitive Positioning',
    'Risks',
    'References',
  ];
  const errors = lintRequiredSections(body, 'strategy', requiredTop);
  const text = String(body || '');
  if (!/kill criterion|kill criteria/i.test(text)) {
    errors.push('strategy depth: each Bet must declare a Kill criterion');
  }
  return errors;
}

/**
 * Runbook depth: diagnostic → remediation → rollback hierarchy markers.
 */
export function lintRunbookDeliveryDepth(body) {
  const requiredTop = [
    'Alert trigger',
    'Symptoms',
    'Impact',
    'Severity and response',
    'Diagnostic steps',
    'Remediation',
    'Rollback',
    'Escalation',
    'Adversarial challenge',
    'References',
  ];
  const errors = lintRequiredSections(body, 'runbook', requiredTop);
  const text = String(body || '');
  if (!/\bD-\d+\b|\bStep\b.*Check|Diagnostic/i.test(text)) {
    errors.push('runbook depth: Diagnostic steps need operator-runnable step markers');
  }
  if (!/\bRB-\d+\b|Rollback|last tested|\[unverified\]/i.test(text)) {
    errors.push('runbook depth: Rollback must record last tested date or [unverified]');
  }
  return errors;
}

/**
 * Research brief depth: falsifiable question + counter-evidence.
 */
export function lintResearchBriefDeliveryDepth(body) {
  const requiredTop = [
    'Question',
    'Method',
    'Sources',
    'Findings',
    'Counter-evidence',
    'Confidence summary',
    'Recommendation',
    'References',
  ];
  const errors = lintRequiredSections(body, 'research-brief', requiredTop);
  const text = String(body || '');
  if (!/observation|inference/i.test(text)) {
    errors.push('research-brief depth: Findings must separate Observation from Inference');
  }
  return errors;
}

/**
 * RFC / platform RFC: goals, alternatives, unresolved questions.
 */
export function lintRfcDeliveryDepth(body, type = 'rfc') {
  const requiredTop = type === 'rfc-platform'
    ? [
      'Summary',
      'Motivation',
      'Breaking change declaration',
      'Proposed contract',
      'Tradeoffs and alternatives',
      'Risks',
      'Verification',
      'Unresolved questions',
      'References',
    ]
    : [
      'Summary',
      'Motivation',
      'Goals & Non-Goals',
      'Proposed design',
      'Tradeoffs and alternatives',
      'Risks',
      'Verification',
      'Unresolved questions',
      'References',
    ];
  const errors = lintRequiredSections(body, type, requiredTop);
  const text = String(body || '');
  if (!/adversarial|fmea/i.test(text)) {
    errors.push(`${type} depth: Risks must include an Adversarial challenge (FMEA) subsection`);
  }
  return errors;
}

const DEPTH_LINTERS = {
  prd: (body) => lintPrdDeliveryDepth(body, { type: 'prd' }),
  'prd-platform': (body) => lintPrdDeliveryDepth(body, {
    type: 'prd-platform',
    requiredTop: [
      'TL;DR',
      'Background',
      'Problem',
      'Outcomes - Goals & Non-Goals',
      'Why This Matters Now',
      'Competitive Landscape & Financial Considerations',
      'Phases',
      'Requirements',
      'Acceptance Criteria',
      'Success Metrics',
      'Risks',
      'References',
    ],
  }),
  'prd-business': lintPrdBusinessDeliveryDepth,
  'meta-prd': lintMetaPrdDeliveryDepth,
  adr: lintAdrDeliveryDepth,
  rfc: (body) => lintRfcDeliveryDepth(body, 'rfc'),
  'rfc-platform': (body) => lintRfcDeliveryDepth(body, 'rfc-platform'),
  strategy: lintStrategyDeliveryDepth,
  runbook: lintRunbookDeliveryDepth,
  'research-brief': lintResearchBriefDeliveryDepth,
};

export function lintArtifactDeliveryDepth(type, body) {
  const lint = DEPTH_LINTERS[type];
  return lint ? lint(body) : [];
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
  if (DEPTH_LINTERS[type]) {
    const raw = readFileSync(filePath, 'utf8');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    // Templates are authoring scaffolds: section presence is enforced via
    // STRUCTURE_REQUIREMENTS; hierarchy depth lints apply to authored bodies.
    // Still run depth lint on templates so scaffolds include the markers.
    errors = [...errors, ...lintArtifactDeliveryDepth(type, body)];
  }
  return errors;
}

export function lintDocVisuals(filePath, type) {
  const postconditions = VISUAL_REQUIREMENTS[type];
  if (!postconditions) return [];
  return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: filePath });
}
