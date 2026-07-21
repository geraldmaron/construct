/**
 * lib/doctor/workspace-preset.mjs — echo active Workspace Preset for doctor.
 *
 * Surfaces whether construct.config.json declares a catalog preset, names the
 * resolved id, and points operators at `construct workspace-preset list` /
 * `apply <id>` when the field is missing or unknown. Skips outside Construct
 * projects so non-project doctor runs stay quiet.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJsonc } from '../jsonc.mjs';
import { CONFIG_DIR_NAME, PROJECT_MARKERS } from '../config-dir.mjs';
import {
  DEFAULT_WORKSPACE_PRESET_ID,
  loadWorkspacePreset,
  listWorkspacePresets,
} from '../workspace-presets/loader.mjs';

function isConstructProject(cwd) {
  return PROJECT_MARKERS.some((m) => existsSync(join(cwd, m)))
    || existsSync(join(cwd, CONFIG_DIR_NAME))
    || existsSync(join(cwd, 'construct.config.json'));
}

function readConfiguredPresetId(cwd) {
  const configFile = join(cwd, 'construct.config.json');
  if (!existsSync(configFile)) return { present: false, id: null, parseError: null };
  try {
    const config = parseJsonc(readFileSync(configFile, 'utf8'));
    const id = typeof config.workspacePreset === 'string' ? config.workspacePreset.trim() : '';
    return { present: true, id: id || null, parseError: null };
  } catch (err) {
    return { present: true, id: null, parseError: err.message };
  }
}

/**
 * @param {string} cwd
 * @param {{ loadPreset?: typeof loadWorkspacePreset, listPresets?: typeof listWorkspacePresets }} [opts]
 * @returns {{ run: boolean, pass: boolean, optional: boolean, label: string }}
 */
export function checkWorkspacePresetForDoctor(cwd, {
  loadPreset = loadWorkspacePreset,
  listPresets = listWorkspacePresets,
} = {}) {
  if (!isConstructProject(cwd)) {
    return { run: false, pass: true, optional: true, label: '' };
  }

  const configured = readConfiguredPresetId(cwd);

  if (configured.parseError) {
    return {
      run: true,
      pass: false,
      optional: true,
      label: `Workspace Preset: construct.config.json unreadable (${configured.parseError}) — run \`construct config validate\``,
    };
  }

  if (!configured.present || !configured.id) {
    const available = listPresets().slice(0, 4).join(', ');
    const more = listPresets().length > 4 ? ', …' : '';
    return {
      run: true,
      pass: false,
      optional: true,
      label: `Workspace Preset not set (runtime default: ${DEFAULT_WORKSPACE_PRESET_ID}) — run \`construct workspace-preset list\` then \`construct workspace-preset apply <id>\`${available ? ` (e.g. ${available}${more})` : ''}`,
    };
  }

  const preset = loadPreset(configured.id);
  if (!preset) {
    return {
      run: true,
      pass: false,
      optional: false,
      label: `Workspace Preset '${configured.id}' unknown — run \`construct workspace-preset list\` then \`construct workspace-preset apply <id>\``,
    };
  }

  const name = preset.displayName || preset.id;
  return {
    run: true,
    pass: true,
    optional: true,
    label: `Workspace Preset: ${preset.id} (${name}) — \`construct workspace-preset show\``,
  };
}
