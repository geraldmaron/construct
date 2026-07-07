/**
 * lib/scopes/teams.mjs — Scope-aware routing hints over the single org chart.
 *
 * Scopes change intake taxonomy and terminology, not org membership. Operations-
 * scope projects map objectives to existing rnd squads (operations-team,
 * engineering-team, product-management-team).
 */

const OPERATIONS_OBJECTIVE_RULES = [
  {
    teamId: 'operations-team',
    focus: 'reliability',
    attachTo: ['cx-operations'],
    pattern: /\b(incident|outage|deploy|deployment|rollback|reliability|runbook|postmortem|sre|on-?call)\b/i,
  },
  {
    teamId: 'product-management-team',
    focus: 'triage',
    attachTo: ['cx-operations', 'cx-product-manager'],
    pattern: /\b(triage|route|routing|priority|queue|intake|request|escalat)/i,
  },
  {
    teamId: 'engineering-team',
    focus: 'implementation',
    attachTo: ['cx-engineer', 'cx-qa'],
    pattern: /\b(implement|build|fix|code|test|review|deliver|patch)\b/i,
  },
];

export const SCOPE_INTENT_TO_TEAM = Object.freeze({
  operations: Object.freeze({
    research: 'product-management-team',
    implementation: 'engineering-team',
    investigation: 'operations-team',
    evaluation: 'engineering-team',
    fix: 'engineering-team',
  }),
});

export function scopeTeamsById(scope) {
  if (!Array.isArray(scope?.teams) || scope.teams.length === 0) return null;
  const byId = {};
  for (const team of scope.teams) {
    if (team?.id) byId[team.id] = team;
  }
  return byId;
}

export function resolveIntentTeamForScope(intent, scope) {
  if (!intent || !scope?.id) return null;
  const map = SCOPE_INTENT_TO_TEAM[scope.id];
  return map?.[intent] ?? null;
}

export function classifyObjectiveForScope(objective = '', scope) {
  const teams = scopeTeamsById(scope);
  if (!teams) return null;

  if (scope.id === 'operations') {
    const text = String(objective);
    for (const rule of OPERATIONS_OBJECTIVE_RULES) {
      if (rule.pattern.test(text)) {
        return {
          focus: rule.focus,
          attachTo: rule.attachTo,
          teamFocus: rule.teamId,
          recommendedTeam: rule.teamId,
          scopeTeamSource: scope.id,
        };
      }
    }
    return {
      focus: 'triage',
      attachTo: ['cx-operations', 'cx-product-manager'],
      teamFocus: 'product-management-team',
      recommendedTeam: 'product-management-team',
      scopeTeamSource: scope.id,
    };
  }

  const firstTeam = scope.teams[0];
  if (!firstTeam?.id) return null;
  const attachTo = Array.isArray(firstTeam.specialists) && firstTeam.specialists.length > 0
    ? firstTeam.specialists
    : (firstTeam.roles ?? []).map((role) => (role.startsWith('cx-') ? role : `cx-${role}`));
  return {
    focus: firstTeam.id,
    attachTo,
    teamFocus: firstTeam.id,
    recommendedTeam: firstTeam.id,
    scopeTeamSource: scope.id,
  };
}

export function resolveScopeTeamMeta(teamId, scope) {
  const teams = scopeTeamsById(scope);
  return teams?.[teamId] ?? null;
}
