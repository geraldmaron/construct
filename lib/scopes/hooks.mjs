/**
 * lib/scopes/hooks.mjs — Scope-level session hook toggles.
 *
 * Curated scopes declare hooks.sessionReflect and hooks.sessionOptimize.
 * Callers consult these before firing optional session-end behaviors.
 */

export function isScopeHookEnabled(scope, hookName) {
  const setting = scope?.hooks?.[hookName];
  if (setting === 'off') return false;
  return setting === 'on' || setting === undefined;
}
