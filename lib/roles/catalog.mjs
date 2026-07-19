/**
 * lib/roles/catalog.mjs — role listing and display helpers.
 *
 * Reads the canonical Worker Profile map in registry to produce the
 * list of available roles. Each descriptor carries the registry-prefixed display
 * name, description, model tier, edit capability, and skill ids — the
 * shape consumed by the `roles:list` CLI command and the embedded capability
 * contract (lib/embed/capability.mjs).
 *
 * The registry exposes Worker Profiles directly; this reader never invents
 * organizational grouping that has no source.
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
  const profiles = Object.values(registry.workerProfiles || {});

  return profiles.map((s) => ({
    id: s.id,
    name: s.id,
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
