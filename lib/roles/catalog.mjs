/**
 * lib/roles/catalog.mjs — role listing and display helpers.
 *
 * Reads the flat `specialists` array in specialists/org to produce the
 * list of available roles. Each descriptor carries the registry-prefixed display
 * name (cx-<name>), description, model tier, edit capability, and skill ids — the
 * shape consumed by the `roles:list` CLI command and the embedded capability
 * contract (lib/embed/capability.mjs).
 *
 * The registry once carried `departments` and `consolidatedRoles` groupings; the
 * schema since collapsed to a single `specialists` array, so this reader exposes
 * the flat list only and never invents grouping that has no source.
 */

import { loadRegistry as loadAssembledRegistry } from '../registry/loader.mjs';

let cached = null;

function loadRegistry() {
  if (cached) return cached;
  cached = loadAssembledRegistry();
  return cached;
}

/**
 * Return the list of role descriptors from the registry's specialists array.
 *
 * @returns {Array<{id:string,name:string,description:string,modelTier:string,internal:boolean,canEdit:boolean,skills:string[]}>}
 */
export function listRoles() {
  const registry = loadRegistry();
  const prefix = registry.prefix || 'cx';
  const specialists = Object.values(registry.workerProfiles || {});

  return specialists.map((s) => ({
    id: s.name,
    name: `${prefix}-${s.name}`,
    description: s.description || '',
    modelTier: s.modelTier || 'standard',
    internal: !!s.internal,
    canEdit: !!s.canEdit,
    skills: Array.isArray(s.skills) ? s.skills : [],
  }));
}

/**
 * Format the role list as a human-readable string.
 *
 * @returns {string}
 */
export function formatRoleList() {
  const roles = listRoles();
  const lines = ['Available Roles', '==============='];
  for (const role of roles) {
    lines.push(`  ${role.name.padEnd(30)} ${role.description}`);
  }
  lines.push('');
  return lines.join('\n');
}
