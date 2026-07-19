/**
 * Resolve the active Workspace Preset from the canonical registry.
 *
 * Construct has one preset catalog and one project configuration field. There
 * are no overlay tiers, anonymous preset files, or compatibility reads.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';
import { getWorkspacePreset, listWorkspacePresets as listRegistryWorkspacePresets } from '../registry/loader.mjs';

export const DEFAULT_WORKSPACE_PRESET_ID = 'rnd';

export function loadWorkspacePreset(id, opts = {}) {
  if (!id || typeof id !== 'string') return null;
  return getWorkspacePreset(id, opts);
}

export function listWorkspacePresets(opts = {}) {
  return listRegistryWorkspacePresets(opts)
    .map((preset) => preset.id)
    .sort();
}

export function resolveActiveWorkspacePreset(cwd, configuredId = null, opts = {}) {
  const id = configuredId || readWorkspacePresetFromProjectConfig(cwd) || DEFAULT_WORKSPACE_PRESET_ID;
  return loadWorkspacePreset(id, opts) || loadWorkspacePreset(DEFAULT_WORKSPACE_PRESET_ID, opts);
}

function readWorkspacePresetFromProjectConfig(cwd) {
  if (!cwd) return null;
  const configFile = join(cwd, 'construct.config.json');
  if (!existsSync(configFile)) return null;
  try {
    const config = parseJsonc(readFileSync(configFile, 'utf8'));
    return typeof config.workspacePreset === 'string' ? config.workspacePreset : null;
  } catch {
    return null;
  }
}
