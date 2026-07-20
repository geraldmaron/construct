/**
 * lib/artifact-workflow.mjs — intent-to-artifact workflow planning.
 *
 * Planning describes Worker Profile work and manifest ordering without reporting a
 * planned role as executed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadProjectConfig } from './config/project-config.mjs';
import {
  BRAND_CAPABLE_FORMATS,
  artifactTypes,
  resolveArtifactType,
  resolveArtifactWorkflowContract,
} from './artifact-manifest.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';
import { validateArtifactRelease } from './artifact-release-gate.mjs';
import { exportMarkdown } from './document-export.mjs';
import { validateExportedDocument } from './export-validate.mjs';
import { makeEvidence, recordCompletion, highestState } from './artifact-completion.mjs';
import { completionRank } from './artifact-completion-states.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRequestedTypes(input, { rootDir, cwd }) {
  const text = String(input ?? '').toLowerCase();
  const matches = [];
  for (const type of artifactTypes({ rootDir, cwd }).sort((a, b) => b.length - a.length)) {
    const entry = resolveArtifactType(type, { rootDir, cwd }).entry;
    for (const candidate of [type, ...(entry?.aliases ?? [])]) {
      if (new RegExp(`(?:^|[^a-z0-9])${escapeRegex(candidate.toLowerCase())}(?:$|[^a-z0-9])`, 'i').test(text)) {
        matches.push(type);
        break;
      }
    }
  }
  return [...new Set(matches)];
}

function inferFormat(input, requestedFormat) {
  if (requestedFormat) return String(requestedFormat).toLowerCase();
  const text = String(input ?? '').toLowerCase();
  for (const format of ['pptx', 'docx', 'pdf', 'deck', 'html', 'doc', 'rtf', 'odt', 'epub', 'tex', 'txt', 'mdx', 'md']) {
    if (new RegExp(`\\b${format}\\b`, 'i').test(text)) return format;
  }
  return null;
}

function inferBranding(input, requestedBranding) {
  if (requestedBranding) return requestedBranding;
  return /\b(?:unbranded|plain|without (?:the )?construct brand)\b/i.test(String(input ?? '')) ? 'plain' : 'construct';
}

function buildSteps({ contract, input, targetFormat, branding }) {
  const text = String(input ?? '').toLowerCase();
  const needsResearch = Boolean(contract.researchProfile) && /\b(?:research|source|evidence|validate claims)\b/.test(text);
  const needsReview = /\b(?:review|critique|audit|feedback)\b/.test(text) || contract.requiredReviewers.length > 0;
  const rewrite = /\b(?:rewrite|revise|edit|polish|improve)\b/.test(text);
  const steps = [];
  if (needsResearch) steps.push({ id: 'research', action: 'research', roles: [], required: false, reason: `research profile: ${contract.researchProfile}` });
  if (needsReview) steps.push({ id: 'review', action: 'review', roles: contract.reviewerChain, required: contract.requiredReviewers.length > 0, reason: 'review occurs before any rewrite' });
  steps.push({
    id: rewrite ? 'rewrite' : 'author',
    action: rewrite ? 'rewrite' : 'author',
    roles: contract.authorChain,
    required: true,
    reason: rewrite ? 'requested revision after review' : 'manifest author chain',
  });
  if (contract.validation.releaseGate !== false) {
    steps.push({ id: 'validate', action: 'validate', roles: [], required: true, reason: 'manifest validation policy' });
  }
  if (targetFormat && BRAND_CAPABLE_FORMATS.includes(targetFormat) && branding === 'construct') {
    steps.push({ id: 'brand', action: 'brand', roles: [], required: true, reason: 'default Construct branding for brand-capable format' });
  }
  if (targetFormat) steps.push({ id: 'export', action: 'export', roles: [], required: true, format: targetFormat, reason: 'requested distribution format' });
  return steps;
}

/**
 * Build an artifact plan from an ordinary request. A missing or ambiguous
 * class is a clarification result, never an implicit PRD route.
 */
export function planArtifactWorkflow(request = {}, { cwd = process.cwd(), rootDir } = {}) {
  const input = request.input ?? request.request ?? '';
  const sourcePath = request.sourcePath ?? request.filePath ?? '';
  const project = request.projectConfig ?? loadProjectConfig(cwd).config;
  const requested = request.artifactType ?? request.documentClass ?? null;
  const pathType = sourcePath && existsSync(sourcePath) ? inferArtifactTypeFromPath(sourcePath, { rootDir: cwd }) : null;
  const inferredTypes = requested ? [] : findRequestedTypes(input, { rootDir, cwd });
  const candidates = requested ? [requested] : [...new Set([pathType, ...inferredTypes].filter(Boolean))];

  if (candidates.length !== 1) {
    return {
      kind: 'artifact-workflow',
      status: 'needs-classification',
      plannedSteps: [],
      executedSteps: [],
      skippedSteps: [],
      producedFiles: [],
      validation: null,
      appliedOverrides: [],
      clarification: candidates.length > 1
        ? `Request names multiple document classes (${candidates.join(', ')}). Specify one registered class.`
        : 'Specify a registered document class, use a typed source path, or register the requested class in registry/artifact-manifest.json.',
    };
  }

  const resolution = resolveArtifactType(candidates[0], { rootDir, cwd });
  if (resolution.status !== 'registered') {
    return {
      kind: 'artifact-workflow',
      status: 'needs-classification',
      plannedSteps: [],
      executedSteps: [],
      skippedSteps: [],
      producedFiles: [],
      validation: null,
      appliedOverrides: [],
      clarification: resolution.guidance,
    };
  }

  const targetFormat = inferFormat(input, request.format ?? request.targetFormat);
  const requestedBranding = inferBranding(input, request.branding);
  const contract = resolveArtifactWorkflowContract(resolution.type, {
    rootDir,
    cwd,
    projectConfig: project,
    overrides: request.overrides,
  });
  const branding = request.branding ?? (requestedBranding === 'plain' ? 'plain' : (contract.outputs.branding ?? 'construct'));
  const steps = buildSteps({ contract, input, targetFormat, branding });
  const unavailableFormat = targetFormat && !contract.outputs.formats.includes(targetFormat);

  return {
    kind: 'artifact-workflow',
    status: unavailableFormat ? 'needs-classification' : 'planned',
    documentClass: contract.documentClass,
    artifactType: contract.type,
    sourcePath: sourcePath || null,
    target: {
      format: targetFormat,
      audience: /\bcustomer(?:-facing)?\b/i.test(input) ? 'customer' : 'internal',
      branding,
      brandCapable: Boolean(targetFormat && BRAND_CAPABLE_FORMATS.includes(targetFormat)),
    },
    contract,
    plannedSteps: steps,
    executedSteps: [],
    skippedSteps: [],
    producedFiles: [],
    validation: null,
    appliedOverrides: contract.appliedOverrides,
    clarification: unavailableFormat ? `${targetFormat} is not an output capability for ${contract.type}.` : null,
  };
}

/**
 * Produce a provenance-preserving workflow run report. Specialist authoring
 * and review are never fabricated: Construct can plan them, but only reports
 * them as executed when a host returns execution evidence (not available in
 * the deterministic entry point). Validation/export are local operations and
 * run only with the explicit durable-write approval mode.
 */
export function runArtifactWorkflow(request = {}, { cwd = process.cwd(), rootDir } = {}) {
  const plan = planArtifactWorkflow(request, { cwd, rootDir });
  const approvalMode = request.approvalMode ?? 'proposal-only';
  const report = {
    reportVersion: 1,
    kind: 'artifact-workflow-run',
    status: plan.status === 'planned' ? 'planned' : plan.status,
    approval: {
      mode: approvalMode,
      durableWriteAllowed: approvalMode === 'allow-durable-write',
    },
    plan,
    plannedSteps: plan.plannedSteps,
    executedSteps: [],
    skippedSteps: [],
    producedFiles: [],
    validation: null,
    completion: [],
    completionState: null,
    appliedOverrides: plan.appliedOverrides,
  };
  if (plan.status !== 'planned') return report;

  const pendingReason = approvalMode === 'allow-durable-write'
    ? 'Worker Profile execution is host-owned; this local command has no Worker Profile execution evidence'
    : `approval mode '${approvalMode}' permits planning only`;
  for (const step of plan.plannedSteps) {
    if (['review', 'rewrite', 'author', 'research'].includes(step.action)) {
      report.skippedSteps.push({ id: step.id, reason: pendingReason });
    }
  }
  if (approvalMode !== 'allow-durable-write') {
    for (const step of plan.plannedSteps) {
      if (!['review', 'rewrite', 'author', 'research'].includes(step.action)) {
        report.skippedSteps.push({ id: step.id, reason: pendingReason });
      }
    }
    return report;
  }

  const sourcePath = plan.sourcePath;
  for (const step of plan.plannedSteps) {
    if (step.action === 'validate') {
      if (!sourcePath) {
        report.skippedSteps.push({ id: step.id, reason: 'validation needs sourcePath or filePath' });
      } else {
        const result = validateArtifactRelease({ filePath: sourcePath, type: plan.artifactType, cwd, rootDir });
        report.validation = result;
        report.executedSteps.push({ id: step.id, result: result.ok ? 'passed' : 'failed' });
        if (!result.ok) {
          report.status = 'validation-failed';
          return report;
        }
      }
    }
    if (step.action === 'brand') {
      // Branding is applied by the export operation. Keeping this pending until
      // output exists avoids claiming a template was applied when no export ran.
      report.skippedSteps.push({ id: step.id, reason: 'branding is evidenced by the export result' });
    }
    if (step.action === 'export') {
      if (!sourcePath) {
        report.skippedSteps.push({ id: step.id, reason: 'export needs sourcePath or filePath' });
      } else {
        const result = exportMarkdown({
          inputPath: sourcePath,
          outputPath: request.outputPath,
          format: step.format,
          artifactType: plan.artifactType,
          branding: plan.target.branding,
          cwd,
          rootDir,
        });
        if (!result.ok) {
          report.status = 'export-failed';
          report.skippedSteps.push({ id: step.id, reason: result.message });
          report.completion = recordCompletion(report.completion, makeEvidence('exported', {
            actor: 'construct-export',
            artifact: sourcePath,
            degradation: result.missing?.length ? 'missing-dependency' : 'unsupported-format',
            proof: { format: step.format, message: result.message },
          }));
          report.completionState = highestState(report.completion);
          return report;
        }
        report.executedSteps.push({ id: step.id, result: 'produced', format: step.format });
        report.producedFiles.push({ path: result.outputPath, format: step.format, branding: result.branding });
        report.completion = recordCompletion(report.completion, makeEvidence('exported', {
          actor: 'construct-export',
          artifact: result.outputPath,
          proof: { format: step.format, branding: result.branding },
        }));

        // Export is not completion (construct-d1r7.12): validate the produced file and record
        // file-valid evidence per format so a standard doc must clear integrity + roundtrip +
        // references, not merely emit a file. A missing validator tool degrades (no advance); a real
        // gap holds the format at exported and is surfaced by the completion gate below.

        const sourceMarkdown = readFileSync(sourcePath, 'utf8');
        const validity = validateExportedDocument({
          outputPath: result.outputPath,
          format: step.format,
          sourceMarkdown,
          baseDir: dirname(sourcePath),
        });
        if (validity.hardFail) {
          report.executedSteps.push({ id: `validate-export:${step.format}`, result: 'failed', format: step.format, reason: validity.message });
        } else {
          report.completion = recordCompletion(report.completion, makeEvidence('file-valid', {
            actor: 'construct-export-validate',
            artifact: result.outputPath,
            proof: { format: step.format, checks: validity.checks, message: validity.message },
            degradation: validity.degraded ? validity.degradation : null,
          }));
        }

        const brandStep = report.skippedSteps.findIndex((entry) => entry.id === 'brand');
        if (brandStep >= 0 && result.branding?.applied === 'construct') {
          report.skippedSteps.splice(brandStep, 1);
          report.executedSteps.push({ id: 'brand', result: 'applied', mechanism: result.branding.mechanism });
        }
      }
    }
  }
  // Per-format completion gate (construct-d1r7.12): a standard document is complete only when each
  // produced format reaches the required states this local workflow can produce (up to file-valid).
  // Required states above file-valid (renderable and beyond) are host/gate-owed, reported as pending
  // rather than failures, preserving the no-forgery invariant. A missing enforceable state names the
  // exact state and format so the failure output is actionable.

  report.completionByFormat = report.producedFiles.map((file) => evaluateFormatCompletion(report.completion, file.format, plan.contract));
  const incomplete = report.completionByFormat.filter((entry) => !entry.met);
  report.completionGaps = incomplete.map((entry) => `${entry.format}: missing ${entry.missing.join(', ')}`);

  if (incomplete.length) {
    report.status = 'completion-incomplete';
  } else {
    report.status = report.executedSteps.length ? 'completed-local-steps' : 'planned';
  }
  report.completionState = highestState(report.completion);
  return report;
}

const LOCAL_MAX_COMPLETION_STATE = 'file-valid';

export function evaluateFormatCompletion(ledger, format, contract) {
  const required = contract?.qualityContract?.perFormat?.[format]?.requiredStates
    ?? contract?.qualityContract?.requiredStates
    ?? ['exported'];
  const achieved = new Set(
    ledger.filter((evidence) => !evidence.degradation && evidence.proof?.format === format).map((evidence) => evidence.state),
  );
  const localCeiling = completionRank(LOCAL_MAX_COMPLETION_STATE);
  const enforceable = required.filter((state) => completionRank(state) <= localCeiling);
  const pending = required.filter((state) => completionRank(state) > localCeiling);
  const missing = enforceable.filter((state) => !achieved.has(state));
  return { format, required, achieved: [...achieved], missing, pending, met: missing.length === 0 };
}
