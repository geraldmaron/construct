/**
 * lib/embed/role-framing.mjs — load and apply role orientations for embed mode.
 *
 * When embed has configured roles (primary/secondary), this module:
 *   1. Loads the embedOrientation from the agent registry for each role
 *   2. Provides a combined lens (focusAreas, riskSignals, artifactBias)
 *   3. Renders a "Role Lens" section for inclusion in snapshots/roadmaps
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', '..', 'agents', 'registry.json');

let _registryCache = null;

function loadRegistry() {
  if (_registryCache) return _registryCache;
  try {
    _registryCache = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    _registryCache = { agents: [] };
  }
  return _registryCache;
}

/**
 * Get the embedOrientation for a named agent role.
 * @param {string} roleName - e.g. 'product-manager', 'architect'
 * @returns {object|null} The embedOrientation object or null
 */
export function getOrientation(roleName) {
  if (!roleName) return null;
  const registry = loadRegistry();
  const agent = (registry.agents ?? []).find((a) => a.name === roleName);
  return agent?.embedOrientation ?? null;
}

/**
 * Build a combined role lens from primary and secondary roles.
 * Primary focusAreas/riskSignals come first; secondary ones are appended (deduplicated).
 *
 * @param {object} roles - { primary: string|null, secondary: string|null }
 * @returns {object} { focusAreas: string[], riskSignals: string[], artifactBias: string[], roles: { primary, secondary } }
 */
export function buildRoleLens(roles) {
  const primary = getOrientation(roles?.primary);
  const secondary = getOrientation(roles?.secondary);

  if (!primary && !secondary) return null;

  const focusAreas = [...(primary?.focusAreas ?? [])];
  const riskSignals = [...(primary?.riskSignals ?? [])];
  const artifactBias = [...(primary?.artifactBias ?? [])];

  // Append secondary, deduplicated
  for (const area of secondary?.focusAreas ?? []) {
    if (!focusAreas.includes(area)) focusAreas.push(area);
  }
  for (const sig of secondary?.riskSignals ?? []) {
    if (!riskSignals.includes(sig)) riskSignals.push(sig);
  }
  for (const bias of secondary?.artifactBias ?? []) {
    if (!artifactBias.includes(bias)) artifactBias.push(bias);
  }

  return {
    focusAreas,
    riskSignals,
    artifactBias,
    roles: { primary: roles.primary, secondary: roles.secondary },
  };
}

/**
 * Render a Role Lens markdown section for inclusion in snapshot/roadmap output.
 * Returns empty string if no roles configured.
 *
 * @param {object} roles - { primary, secondary } from embed config
 * @returns {string}
 */
export function renderRoleLensSection(roles) {
  const lens = buildRoleLens(roles);
  if (!lens) return '';

  const lines = ['## Role Lens', ''];

  if (lens.roles.primary) lines.push(`- **Primary**: ${lens.roles.primary}`);
  if (lens.roles.secondary) lines.push(`- **Secondary**: ${lens.roles.secondary}`);
  lines.push('');

  if (lens.focusAreas.length) {
    lines.push(`**Focus**: ${lens.focusAreas.join(', ')}`);
  }
  if (lens.riskSignals.length) {
    lines.push(`**Risk signals**: ${lens.riskSignals.join(', ')}`);
  }
  if (lens.artifactBias.length) {
    lines.push(`**Artifact bias**: ${lens.artifactBias.join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}

/** Reset internal cache (for testing). */
export function _resetCache() { _registryCache = null; }
