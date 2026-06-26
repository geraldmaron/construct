/**
 * lib/scopes/research-profile.mjs — Map intake types to research depth profiles.
 *
 * Scope JSON may declare researchProfiles (user, codebase, external, market).
 * Artifact manifest entries carry a default researchProfile; scope overrides win.
 */

export function resolveResearchProfile({ intakeType, artifactType, scope } = {}) {
  if (scope?.researchProfiles && intakeType && scope.researchProfiles[intakeType]) {
    return scope.researchProfiles[intakeType];
  }
  if (scope?.researchProfiles && artifactType && scope.researchProfiles[artifactType]) {
    return scope.researchProfiles[artifactType];
  }
  return null;
}
