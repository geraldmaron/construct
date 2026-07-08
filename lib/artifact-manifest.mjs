/**
 * lib/artifact-manifest.mjs — Load and resolve the artifact capability manifest.
 *
 * specialists/artifact-manifest.json is the single source of truth for document
 * type metadata: templates, tone, structure, visuals, and release gates.
 * Consumer projects without a local copy resolve the shipped manifest from the
 * Construct package root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath } from './config-dir.mjs';
import { resolveActiveScope } from './scopes/loader.mjs';
import { COMPLETION_STATES, isCompletionState } from './artifact-completion-states.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY_MANIFEST = { version: 1, artifacts: {} };

// Kept here, next to the manifest resolver, so every public workflow surface
// uses one answer for what can carry Construct styling. Source formats remain
// deliberately plain unless a caller explicitly asks otherwise.
export const BRAND_CAPABLE_FORMATS = Object.freeze(['pdf', 'docx', 'doc', 'deck', 'pptx', 'html', 'rtf', 'odt', 'epub', 'tex']);
export const PLAIN_OUTPUT_FORMATS = Object.freeze(['txt', 'md', 'mdx']);

// Quality-gate levels run from cheapest source lint to full visual certification; an artifact's
// qualityContract.gateLevel selects which deterministic checks block. The completion-state
// vocabulary it references lives in artifact-completion-states.mjs.

export const GATE_LEVELS = Object.freeze(['fast', 'standard', 'render-smoke', 'full-certification', 'human-reviewed']);

let cached = null;
let cachedRoot = null;

function manifestPathForRoot(root) {
  return path.join(root, 'specialists', 'artifact-manifest.json');
}

export function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    const manifest = manifestPathForRoot(current);
    if (fs.existsSync(manifest)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs.existsSync(manifestPathForRoot(PACKAGE_ROOT))) return PACKAGE_ROOT;
  return null;
}

export function loadArtifactManifest({ rootDir, force = false, cwd = process.cwd() } = {}) {
  const resolvedRoot = rootDir ?? findConstructRoot(cwd) ?? PACKAGE_ROOT;
  if (cached && !force && cachedRoot === resolvedRoot) return cached;

  const p = manifestPathForRoot(resolvedRoot);
  if (!fs.existsSync(p)) {
    cached = EMPTY_MANIFEST;
    cachedRoot = resolvedRoot;
    return cached;
  }

  cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  cachedRoot = resolvedRoot;
  return cached;
}

export function getArtifactEntry(type, opts = {}) {
  const manifest = loadArtifactManifest(opts);
  return manifest.artifacts?.[type] ?? null;
}

export function artifactTypes(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  return Object.keys(manifest.artifacts ?? {});
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(...values) {
  const out = {};
  for (const value of values) {
    if (!isObject(value)) continue;
    for (const [key, next] of Object.entries(value)) {
      out[key] = isObject(next) && isObject(out[key]) ? mergeObjects(out[key], next) : structuredClone(next);
    }
  }
  return out;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

/**
 * Resolve a user-facing type or registered alias. The result intentionally
 * distinguishes an unknown request from a fallback: callers must ask for
 * classification/registration instead of silently turning it into a PRD.
 */
export function resolveArtifactType(type, opts = {}) {
  const requestedType = String(type ?? '').trim().toLowerCase();
  const manifest = loadArtifactManifest(opts);
  if (!requestedType) {
    return {
      status: 'unrecognized',
      requestedType: null,
      type: null,
      guidance: 'Specify a registered document class or register one in specialists/artifact-manifest.json.',
    };
  }
  for (const [registeredType, entry] of Object.entries(manifest.artifacts ?? {})) {
    const aliases = [registeredType, ...(entry.aliases ?? [])].map((value) => String(value).toLowerCase());
    if (aliases.includes(requestedType)) {
      return { status: 'registered', requestedType, type: registeredType, entry };
    }
  }
  return {
    status: 'unrecognized',
    requestedType,
    type: null,
    guidance: `Document class '${requestedType}' is not registered. Classify the request or add it to specialists/artifact-manifest.json.`,
  };
}

/**
 * Resolve the canonical workflow contract for a registered document class.
 * Precedence is deliberately explicit: invocation > project config > manifest
 * defaults. Existing entries remain compatible: primaryOwners and releaseGate
 * are the fallback author and reviewer/validation declarations.
 */
export function resolveArtifactWorkflowContract(type, {
  rootDir,
  cwd = process.cwd(),
  projectConfig = null,
  overrides = null,
} = {}) {
  const resolved = resolveArtifactType(type, { rootDir, cwd });
  if (resolved.status !== 'registered') return resolved;

  const manifest = loadArtifactManifest({ rootDir, cwd });
  const entry = resolved.entry;
  const config = projectConfig?.artifactWorkflow ?? {};
  const manifestDefaults = manifest.workflowDefaults ?? {};
  const projectType = config.types?.[resolved.type] ?? {};
  const appliedOverrides = [];
  if (isObject(config.defaults) && Object.keys(config.defaults).length) appliedOverrides.push('project.defaults');
  if (isObject(projectType) && Object.keys(projectType).length) appliedOverrides.push(`project.types.${resolved.type}`);
  if (isObject(overrides) && Object.keys(overrides).length) appliedOverrides.push('invocation');

  const configured = mergeObjects(manifestDefaults, entry, config.defaults, projectType, overrides);
  const releaseGate = configured.releaseGate ?? {};
  const authorChain = unique(configured.authorChain ?? configured.primaryOwners ?? []);
  const reviewerChain = unique(configured.reviewerChain ?? [
    ...(releaseGate.requiredReviewers ?? []),
    ...(releaseGate.optionalReviewers ?? []),
  ]);
  const outputs = mergeObjects({
    formats: [...BRAND_CAPABLE_FORMATS, ...PLAIN_OUTPUT_FORMATS],
    branding: 'construct',
  }, configured.outputs);
  const qualityContract = mergeObjects({
    gateLevel: 'standard',
    requiredStates: ['exported', 'file-valid'],
  }, configured.qualityContract);
  const validation = mergeObjects({ releaseGate: true }, configured.validation);

  return {
    status: 'registered',
    requestedType: resolved.requestedType,
    type: resolved.type,
    documentClass: configured.documentClass ?? resolved.type,
    template: configured.template ?? null,
    workflowSkill: configured.workflowSkill ?? null,
    authorChain,
    reviewerChain,
    requiredReviewers: unique(releaseGate.requiredReviewers ?? []),
    optionalReviewers: unique(releaseGate.optionalReviewers ?? []),
    researchProfile: configured.researchProfile ?? null,
    validation,
    releaseGate,
    outputs,
    qualityContract,
    appliedOverrides,
  };
}

/** A dependency-free validator used by startup checks and tests. */
export function validateArtifactManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) return { valid: false, errors: ['root: must be an object'] };
  if (!Number.isInteger(manifest.version) || manifest.version < 1) errors.push('version: must be an integer >= 1');
  if (!isObject(manifest.artifacts)) errors.push('artifacts: must be an object');
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    const prefix = `artifacts.${type}`;
    if (!isObject(entry)) { errors.push(`${prefix}: must be an object`); continue; }
    if (typeof entry.template !== 'string' || !entry.template) errors.push(`${prefix}.template: required string missing`);
    if (!Array.isArray(entry.primaryOwners) || entry.primaryOwners.some((owner) => typeof owner !== 'string')) {
      errors.push(`${prefix}.primaryOwners: required string array missing`);
    }
    for (const field of ['authorChain', 'reviewerChain', 'aliases']) {
      if (entry[field] !== undefined && (!Array.isArray(entry[field]) || entry[field].some((value) => typeof value !== 'string'))) {
        errors.push(`${prefix}.${field}: must be an array of strings`);
      }
    }
    if (entry.outputs?.formats !== undefined && (!Array.isArray(entry.outputs.formats) || entry.outputs.formats.length === 0)) {
      errors.push(`${prefix}.outputs.formats: must be a non-empty array`);
    }
    if (entry.outputs?.branding !== undefined && !['construct', 'plain'].includes(entry.outputs.branding)) {
      errors.push(`${prefix}.outputs.branding: must be construct or plain`);
    }
    const gateLevel = entry.qualityContract?.gateLevel;
    if (gateLevel !== undefined && !GATE_LEVELS.includes(gateLevel)) {
      errors.push(`${prefix}.qualityContract.gateLevel: must be one of ${GATE_LEVELS.join(', ')}`);
    }
    if (entry.qualityContract?.requiredStates !== undefined
      && (!Array.isArray(entry.qualityContract.requiredStates)
        || entry.qualityContract.requiredStates.some((state) => !isCompletionState(state)))) {
      errors.push(`${prefix}.qualityContract.requiredStates: must be completion states (${COMPLETION_STATES.join(', ')})`);
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
}

export function structureRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.structureRequirements?.length) out[type] = entry.structureRequirements;
  }
  return out;
}

export function visualRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.visualRequirements?.length) out[type] = entry.visualRequirements;
  }
  return out;
}

export function loadBrandVoice(cwd = process.cwd()) {
  const p = configPath(cwd, 'brand-voice.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveToneForArtifact(type, { cwd = process.cwd(), rootDir } = {}) {
  const entry = getArtifactEntry(type, { rootDir, cwd });
  const brand = loadBrandVoice(cwd);
  const override = brand?.toneOverride?.[type];
  if (override) return override;
  try {
    const scope = resolveActiveScope(cwd);
    const scopeTone = scope?.toneDefaults?.[type];
    if (scopeTone) return scopeTone;
  } catch { /* scope optional */ }
  return entry?.toneDefault ?? 'direct';
}

export function templateMetadata(type, { cwd = process.cwd(), rootDir } = {}) {
  const workflow = resolveArtifactWorkflowContract(type, { rootDir, cwd });
  if (workflow.status !== 'registered') return null;
  const entry = getArtifactEntry(workflow.type, { rootDir, cwd });
  return {
    type: workflow.type,
    documentClass: workflow.documentClass,
    tone: resolveToneForArtifact(workflow.type, { cwd, rootDir }),
    toneAllowed: entry.toneAllowed ?? [],
    structureRequirements: entry.structureRequirements ?? [],
    visualRequirements: entry.visualRequirements ?? [],
    primaryOwners: entry.primaryOwners ?? [],
    workflowSkill: entry.workflowSkill ?? null,
    releaseGate: entry.releaseGate ?? null,
    authorChain: workflow.authorChain,
    reviewerChain: workflow.reviewerChain,
    validation: workflow.validation,
    outputs: workflow.outputs,
  };
}
