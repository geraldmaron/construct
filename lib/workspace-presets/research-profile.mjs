/**
 * Map Workspace Preset intake types to research depth profiles.
 *
 * Workspace Presets may declare researchProfiles. Preset overrides win.
 */

export function resolveResearchProfile({ intakeType, artifactType, workspacePreset } = {}) {
  if (workspacePreset?.researchProfiles && intakeType && workspacePreset.researchProfiles[intakeType]) {
    return workspacePreset.researchProfiles[intakeType];
  }
  if (workspacePreset?.researchProfiles && artifactType && workspacePreset.researchProfiles[artifactType]) {
    return workspacePreset.researchProfiles[artifactType];
  }
  return null;
}
