/**
 * lib/scopes/enrich.mjs — Attach org teams and roles to an active work scope.
 *
 * Worker profiles (specialists/org/worker-profiles/*.json) carry intake taxonomy, templates, and
 * tone only. Teams and roles always come from specialists/org — one org, no
 * per-scope squad forks.
 */

import { loadRegistry } from '../registry/loader.mjs';

function mapTeam(team) {
  return {
    id: team.id,
    name: team.name || team.id,
    owner: team.owner,
    roles: team.roles || [],
    decisionRights: team.decisionRights || [],
    forbiddenDecisions: team.forbiddenDecisions || [],
    escalationPath: team.escalationPath || [],
    charter: team.charter || '',
    contact: team.contact || {},
    specialists: team.specialists || [],
    groupId: team.groupId || null,
    kind: team.kind || null,
  };
}

export function registryTeamsFromOrg(registry) {
  return Object.values(registry.teams || {})
    .filter((team) => team?.id)
    .map(mapTeam)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function deriveRegistryRoles(registry) {
  const roles = new Set();
  for (const spec of Object.values(registry.specialists || {})) {
    if (spec?.name) roles.add(spec.name);
  }
  return [...roles].sort();
}

export function enrichScope(raw, { rootDir } = {}) {
  if (!raw || typeof raw !== 'object') return raw;
  const scope = { ...raw };
  const registry = loadRegistry({ rootDir });

  if (!Array.isArray(scope.teams) || scope.teams.length === 0) {
    scope.teams = registryTeamsFromOrg(registry);
  }

  if (!Array.isArray(scope.roles) || scope.roles.length === 0) {
    scope.roles = deriveRegistryRoles(registry);
  }

  return scope;
}

export function collectScopeRoleIds(rawScope, { rootDir } = {}) {
  const enriched = enrichScope(rawScope, { rootDir });
  const roles = new Set(enriched?.roles || []);
  for (const team of enriched?.teams || []) {
    for (const role of team.roles || []) roles.add(role);
    if (team.owner) roles.add(team.owner);
  }
  return roles;
}
