/**
 * lib/worker-profiles/prompt-schema.mjs — validation for Worker Profile prompts.
 *
 * Worker Profile prompts use YAML frontmatter plus an authored Markdown body.
 * Validation enforces the frontmatter and canonical-section contract, and gates
 * the highest-value invariant — the
 * frontmatter `perspective{}` is the sole source of truth (ADR-0037); registry.json
 * carries routing metadata only.
 *
 * Frontmatter is the source of truth. A missing frontmatter block is reported
 * as an incomplete prompt, while canonical-section checks remain warnings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { loadRegistry as loadRuntimeRegistry } from '../registry/loader.mjs';

export const REQUIRED_FRONTMATTER = ['workerProfileId', 'version', 'perspective'];
export const PERSPECTIVE_FIELDS = ['bias', 'tension', 'openingQuestion', 'failureMode'];
export const OPTIONAL_FRONTMATTER = ['perspectiveGuidance', 'perspectives', 'templates', 'preloadPerspectiveGuidance'];
export const REQUIRED_SECTIONS = ['Anti-fabrication contract', 'Output format'];
export const CANONICAL_SECTIONS = [
  'Orientation', 'Anti-fabrication contract', 'Productive tension',
  'Opening question', 'Failure mode', 'Domain overlays', 'Output format',
];

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Split a prompt file into { frontmatter, body }. frontmatter is null when the
 * file has none, or undefined when the YAML failed to parse.
 */
export function splitFrontmatter(text) {
  const raw = String(text ?? '');
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: null, body: raw };
  try {
    const fm = load(m[1]);
    return { frontmatter: (fm && typeof fm === 'object') ? fm : {}, body: raw.slice(m[0].length) };
  } catch (err) {
    return { frontmatter: undefined, body: raw.slice(m[0].length), error: err.message };
  }
}

function hasHeading(body, title) {
  const target = String(title).trim().toLowerCase();
  const re = /^#{1,6}\s+(.+)$/gm;
  let m;
  while ((m = re.exec(body))) {
    if (m[1].trim().toLowerCase() === target) return true;
  }
  return false;
}

/**
 * Validate one prompt file's content against the hybrid format.
 *
 * @param {object} opts
 * @param {string} opts.content - raw file content
 * @param {string} [opts.id] - Worker Profile id for messages
 * @param {object} [opts.registryEntry] - the matching registry Worker Profile
 * @returns {{ converted: boolean, errors: string[], warnings: string[] }}
 */
export function validatePromptContent({ content, id = '(prompt)', registryEntry } = {}) {
  const errors = [];
  const warnings = [];
  const { frontmatter, body, error } = splitFrontmatter(content);

  if (frontmatter === null) {
    return { converted: false, errors, warnings: [`${id}: no Worker Profile frontmatter`] };
  }
  if (frontmatter === undefined) {
    errors.push(`${id}: frontmatter is not valid YAML — ${error}`);
    return { converted: true, errors, warnings };
  }

  for (const field of REQUIRED_FRONTMATTER) {
    if (frontmatter[field] == null || frontmatter[field] === '') {
      errors.push(`${id}: missing required frontmatter field "${field}"`);
    }
  }

  if (frontmatter.workerProfileId && registryEntry?.id) {
    if (frontmatter.workerProfileId !== registryEntry.id) {
      errors.push(`${id}: frontmatter workerProfileId "${frontmatter.workerProfileId}" must equal "${registryEntry.id}"`);
    }
  }
  if (frontmatter.version != null && !Number.isInteger(frontmatter.version)) {
    errors.push(`${id}: frontmatter version must be an integer (got ${JSON.stringify(frontmatter.version)})`);
  }

  const persp = frontmatter.perspective;
  if (persp && typeof persp === 'object') {
    for (const f of PERSPECTIVE_FIELDS) {
      if (!persp[f] || !String(persp[f]).trim()) errors.push(`${id}: perspective.${f} is required and must be non-empty`);
    }
  } else if (frontmatter.perspective != null) {
    errors.push(`${id}: perspective must be an object with ${PERSPECTIVE_FIELDS.join(', ')}`);
  }

  const known = new Set([...REQUIRED_FRONTMATTER, ...OPTIONAL_FRONTMATTER]);
  for (const key of Object.keys(frontmatter)) {
    if (!known.has(key)) warnings.push(`${id}: unknown frontmatter key "${key}"`);
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!hasHeading(body, section)) warnings.push(`${id}: missing canonical section "## ${section}" (warn-only until body normalization)`);
  }

  return { converted: true, errors, warnings };
}

/**
 * Validate every canonical Worker Profile prompt.
 * @returns {{ errors: string[], warnings: string[], total: number, converted: number }}
 */
export function validatePromptFiles({ rootDir = process.cwd(), registry } = {}) {
  const errors = [];
  const warnings = [];
  let total = 0;
  let converted = 0;

  const reg = registry ?? loadPromptRegistry(rootDir);
  const workerProfiles = Object.values(reg?.workerProfiles || {});

  const seen = new Set();
  for (const entry of workerProfiles) {
    const promptPath = path.join('registry', 'worker-profiles', 'prompts', `${entry.id}.md`);
    if (seen.has(promptPath)) continue;
    seen.add(promptPath);
    const filePath = path.join(rootDir, promptPath);
    if (!fs.existsSync(filePath)) { errors.push(`${entry.id}: prompt ${promptPath} does not exist`); continue; }
    total += 1;
    const content = fs.readFileSync(filePath, 'utf8');
    const result = validatePromptContent({ content, id: entry.id, registryEntry: entry });
    if (result.converted) converted += 1;
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings, total, converted };
}

function loadPromptRegistry(rootDir) {
  try {
    return loadRuntimeRegistry({ rootDir });
  } catch {
    return { workerProfiles: {} };
  }
}

/**
 * Resolve a Worker Profile's perspective from its prompt frontmatter.
 * @param {string} workerProfileId - canonical Worker Profile id
 * @returns {object|null}
 */
export function resolvePerspectiveFromPrompt(workerProfileId, { rootDir = process.cwd(), registry } = {}) {
  const reg = registry ?? loadPromptRegistry(rootDir);
  const entry = reg.workerProfiles?.[workerProfileId];
  if (!entry) return null;
  const filePath = path.join(rootDir, 'registry', 'worker-profiles', 'prompts', `${entry.id}.md`);
  if (!fs.existsSync(filePath)) return null;
  const { frontmatter } = splitFrontmatter(fs.readFileSync(filePath, 'utf8'));
  const persp = frontmatter?.perspective;
  return persp && typeof persp === 'object' ? persp : null;
}
