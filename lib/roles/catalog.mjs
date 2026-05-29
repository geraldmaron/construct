/**
 * lib/roles/catalog.mjs — role listing and display helpers.
 *
 * Reads specialists/registry.json to produce a list of available roles with
 * optional department grouping and consolidated-role views. Consumed by the
 * `roles:list` CLI command.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', '..', 'specialists', 'registry.json');

let cached = null;

function loadRegistry() {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  return cached;
}

/**
 * Return a list of role descriptors.
 *
 * @param {object}  opts
 * @param {boolean} opts.departments   Group by department when true.
 * @param {boolean} opts.consolidated  Return consolidated 12-role view when true.
 * @returns {Array<object>}
 */
export function listRoles({ departments = false, consolidated = false } = {}) {
  const registry = loadRegistry();

  if (consolidated) {
    const c = registry.consolidatedRoles || {};
    return (c.roles || []).map((r) => ({
      id: r.id,
      absorbs: r.absorbs || [],
      whenToUse: r.whenToUse || '',
    }));
  }

  const agents = Array.isArray(registry.agents)
    ? registry.agents
    : Object.values(registry.agents || {});

  if (!departments) {
    return agents.map((a) => ({
      id: a.name,
      name: `cx-${a.name}`,
      description: a.description || '',
      internal: !!a.internal,
    }));
  }

  // Group by department based on subDepartment membership in registry.departments
  const depts = registry.departments || {};
  const grouped = {};
  for (const [deptId, dept] of Object.entries(depts)) {
    grouped[deptId] = {
      name: dept.name || deptId,
      roles: [],
    };
  }
  grouped._ungrouped = { name: 'Other', roles: [] };

  for (const agent of agents) {
    let placed = false;
    for (const [deptId, dept] of Object.entries(depts)) {
      const subs = dept.subDepartments || {};
      for (const sub of Object.values(subs)) {
        if ((sub.roles || []).includes(agent.name) || (sub.roles || []).includes(`cx-${agent.name}`)) {
          grouped[deptId].roles.push({ id: agent.name, name: `cx-${agent.name}`, description: agent.description || '' });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      grouped._ungrouped.roles.push({ id: agent.name, name: `cx-${agent.name}`, description: agent.description || '' });
    }
  }

  return Object.entries(grouped)
    .filter(([, g]) => g.roles.length > 0)
    .map(([id, g]) => ({ departmentId: id, departmentName: g.name, roles: g.roles }));
}

/**
 * Format the role list as a human-readable string.
 *
 * @param {object}  opts  Same options as listRoles.
 * @returns {string}
 */
export function formatRoleList({ departments = false, consolidated = false } = {}) {
  const roles = listRoles({ departments, consolidated });
  const lines = [];

  if (consolidated) {
    lines.push('Consolidated Roles (12-role simplified structure)');
    lines.push('=================================================');
    for (const r of roles) {
      lines.push(`\n${r.id}`);
      lines.push(`  Absorbs: ${r.absorbs.join(', ')}`);
      lines.push(`  Use when: ${r.whenToUse}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  if (departments) {
    lines.push('Available Roles by Department');
    lines.push('=============================');
    for (const group of roles) {
      lines.push(`\n${group.departmentName}`);
      for (const role of group.roles) {
        lines.push(`  ${role.name.padEnd(30)} ${role.description}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('Available Roles');
  lines.push('===============');
  for (const role of roles) {
    lines.push(`  ${role.name.padEnd(30)} ${role.description}`);
  }
  lines.push('');
  return lines.join('\n');
}
