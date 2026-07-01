/**
 * lib/registry/validate.mjs — validate registry/capabilities.json against repo reality.
 *
 * Checks that declared skills, templates, workflow types, and verification paths
 * resolve on disk; flags stale lastValidated entries; ensures every embedded
 * workflow type has a registry row. Consumed by `construct registry validate`
 * and `construct doctor`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKFLOW_TYPES } from '../embedded-contract/workflow-defs.mjs';
import { STRUCTURE_REQUIREMENTS } from '../templates/visual-requirements.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'registry', 'capabilities.json');
const STALE_MS = 90 * 24 * 60 * 60 * 1000;

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

function resolveSkillPath(skillId) {
  return path.join(REPO_ROOT, 'skills', `${skillId}.md`);
}

function resolveTemplate(name) {
  const shipped = path.join(REPO_ROOT, 'templates', 'docs', `${name}.md`);
  if (exists(path.relative(REPO_ROOT, shipped))) return true;
  return false;
}

export function loadCapabilityRegistry({ rootDir = REPO_ROOT } = {}) {
  const file = path.join(rootDir, 'registry', 'capabilities.json');
  if (!fs.existsSync(file)) {
    return { version: 0, capabilities: [], error: 'registry/capabilities.json missing' };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { version: 0, capabilities: [], error: err?.message || String(err) };
  }
}

export function validateCapabilityRegistry({ rootDir = REPO_ROOT, now = Date.now() } = {}) {
  const raw = loadCapabilityRegistry({ rootDir });
  const errors = [];
  const warnings = [];
  const ids = new Set();

  if (raw.error) errors.push(raw.error);

  for (const cap of raw.capabilities ?? []) {
    if (!cap.id) {
      errors.push('capability missing id');
      continue;
    }
    if (ids.has(cap.id)) errors.push(`duplicate capability id: ${cap.id}`);
    ids.add(cap.id);

    if (cap.skill && !fs.existsSync(resolveSkillPath(cap.skill))) {
      errors.push(`${cap.id}: skill file missing: skills/${cap.skill}.md`);
    }

    if (cap.embeddedWorkflow && !WORKFLOW_TYPES.includes(cap.embeddedWorkflow)) {
      errors.push(`${cap.id}: unknown embeddedWorkflow "${cap.embeddedWorkflow}"`);
    }

    if (cap.template && !resolveTemplate(cap.template)) {
      errors.push(`${cap.id}: template missing: templates/docs/${cap.template}.md`);
    }

    const ver = cap.verification ?? {};
    if (ver.functional && !exists(ver.functional)) {
      errors.push(`${cap.id}: verification.functional missing: ${ver.functional}`);
    }
    if (ver.hostEmulation && !exists(ver.hostEmulation)) {
      errors.push(`${cap.id}: verification.hostEmulation missing: ${ver.hostEmulation}`);
    }
    if (ver.structureRequirements && !STRUCTURE_REQUIREMENTS[ver.structureRequirements]) {
      errors.push(`${cap.id}: unknown structureRequirements "${ver.structureRequirements}"`);
    }

    const hasTest = ver.functional || ver.hostEmulation || ver.untestableRationale;
    if (!hasTest && (cap.criticality === 'P0' || cap.criticality === 'P1')) {
      errors.push(`${cap.id}: P0/P1 capability has no functional test or untestableRationale`);
    }

    const surfaces = cap.surfaces ?? {};
    for (const [surface, status] of Object.entries(surfaces)) {
      if (!status?.supported) continue;
      if (status.primary) {
        const tierPath = path.join('tests', 'capabilities', cap.id, `${surface}.test.mjs`);
        const hasSurfaceTest = exists(tierPath);
        const hasFunctional = !!(ver.functional || ver.hostEmulation);
        if (!hasSurfaceTest && !hasFunctional && !ver.untestableRationale) {
          warnings.push(`${cap.id}: primary surface "${surface}" has no tests/capabilities/${cap.id}/${surface}.test.mjs`);
        }
      }
    }

    if (cap.lastValidated) {
      const age = now - Date.parse(cap.lastValidated);
      if (Number.isFinite(age) && age > STALE_MS) {
        errors.push(`${cap.id}: lastValidated older than 90 days (${cap.lastValidated})`);
      }
    } else if (cap.criticality === 'P0') {
      errors.push(`${cap.id}: P0 capability never validated (lastValidated null)`);
    }

    for (const dep of cap.dependencies?.skills ?? []) {
      if (!fs.existsSync(resolveSkillPath(dep))) {
        errors.push(`${cap.id}: dependency skill missing: skills/${dep}.md`);
      }
    }
  }

  for (const wf of WORKFLOW_TYPES) {
    const covered = (raw.capabilities ?? []).some((c) => c.embeddedWorkflow === wf);
    if (!covered) {
      warnings.push(`embedded workflow "${wf}" has no registry entry yet`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    count: (raw.capabilities ?? []).length,
    registryPath: path.join(rootDir, 'registry', 'capabilities.json'),
  };
}
