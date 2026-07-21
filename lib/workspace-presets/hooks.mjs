/**
 * Workspace Preset session hook toggles.
 *
 * Workspace Presets declare hooks.sessionReflect and hooks.sessionOptimize.
 * Callers consult these before firing optional session-end behaviors.
 */

export function isWorkspacePresetHookEnabled(workspacePreset, hookName) {
  const setting = workspacePreset?.hooks?.[hookName];
  if (setting === 'off') return false;
  return setting === 'on' || setting === undefined;
}
