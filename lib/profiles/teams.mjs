/**
 * lib/profiles/teams.mjs — Profile-defined team resolution for headhunt and orchestration.
 *
 * Curated profiles declare a `teams[]` collection with decision rights and escalation
 * paths. When the active profile carries teams, routing prefers those ids over the
 * unified-registry group ids (engineering-group, etc.).
 */

const OPERATIONS_OBJECTIVE_RULES = [
  {
    teamId: 'reliability-team',
    focus: 'reliability',
    attachTo: ['cx-sre', 'cx-docs-keeper'],
    pattern: /\b(incident|outage|deploy|deployment|rollback|reliability|runbook|postmortem|sre|on-?call)\b/i,
  },
  {
    teamId: 'triage-team',
    focus: 'triage',
    attachTo: ['cx-operations', 'cx-product-manager'],
    pattern: /\b(triage|route|routing|priority|queue|intake|request|escalat)/i,
  },
  {
    teamId: 'delivery-team',
    focus: 'implementation',
    attachTo: ['cx-engineer', 'cx-qa'],
    pattern: /\b(implement|build|fix|code|test|review|deliver|patch)\b/i,
  },
];

export const PROFILE_INTENT_TO_TEAM = Object.freeze({
  operations: Object.freeze({
    research: 'triage-team',
    implementation: 'delivery-team',
    investigation: 'reliability-team',
    evaluation: 'delivery-team',
    fix: 'delivery-team',
  }),
});

export function profileTeamsById(profile) {
  if (!Array.isArray(profile?.teams) || profile.teams.length === 0) return null;
  const byId = {};
  for (const team of profile.teams) {
    if (team?.id) byId[team.id] = team;
  }
  return byId;
}

export function resolveIntentTeamForProfile(intent, profile) {
  if (!intent || !profile?.id) return null;
  const map = PROFILE_INTENT_TO_TEAM[profile.id];
  return map?.[intent] ?? null;
}

export function classifyObjectiveForProfile(objective = '', profile) {
  const teams = profileTeamsById(profile);
  if (!teams) return null;

  if (profile.id === 'operations') {
    const text = String(objective);
    for (const rule of OPERATIONS_OBJECTIVE_RULES) {
      if (rule.pattern.test(text)) {
        return {
          focus: rule.focus,
          attachTo: rule.attachTo,
          teamFocus: rule.teamId,
          recommendedTeam: rule.teamId,
          profileTeamSource: profile.id,
        };
      }
    }
    return {
      focus: 'triage',
      attachTo: ['cx-operations', 'cx-product-manager'],
      teamFocus: 'triage-team',
      recommendedTeam: 'triage-team',
      profileTeamSource: profile.id,
    };
  }

  const firstTeam = profile.teams[0];
  if (!firstTeam?.id) return null;
  return {
    focus: firstTeam.id,
    attachTo: (firstTeam.roles ?? []).map((role) => (role.startsWith('cx-') ? role : `cx-${role}`)),
    teamFocus: firstTeam.id,
    recommendedTeam: firstTeam.id,
    profileTeamSource: profile.id,
  };
}

export function resolveProfileTeamMeta(teamId, profile) {
  const teams = profileTeamsById(profile);
  return teams?.[teamId] ?? null;
}
