/**
 * lib/chat/config.mjs — persisted settings for `construct chat`.
 *
 * Settings are layered: built-in DEFAULTS < global (~/.cx/chat-config.json) <
 * project (<project>/.cx/chat-config.json). Reads merge all three; writes always go
 * to the project file (resolveProjectScopedPath falls back to ~/.cx when there is no
 * project root), so a user's global preferences seed every project while per-project
 * overrides stay local. Only the known, validated keys are persisted.
 *
 * Exposed settings: host, model, transparency layers, thinking, permissionMode,
 * sandbox, ui (ascii, inspector). Validation lives here so the command layer and the launcher
 * share one source of truth for allowed values.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProjectScopedPath } from '../project-root.mjs';

export const LAYER_KEYS = ['thinking', 'path', 'specialists', 'tools', 'observability'];
export const PERMISSION_MODES = ['ask', 'allow_once', 'allow_always', 'reject'];
export const SANDBOX_LEVELS = ['read-only', 'workspace-write', 'danger-full-access'];

export const INSPECTOR_MODES = ['off', 'auto', 'on'];
export const THEME_MODES = ['auto', 'light', 'dark'];
export const MODEL_MODES = ['pinned', 'free-router'];

export const DEFAULTS = Object.freeze({
  host: null,
  model: null,
  modelMode: 'pinned',
  layers: Object.freeze(Object.fromEntries(LAYER_KEYS.map((k) => [k, true]))),
  thinking: true,
  permissionMode: 'allow_once',
  sandbox: null,
  ui: Object.freeze({ ascii: false, inspector: 'auto', theme: 'auto' }),
});

const CONFIG_BASENAME = 'chat-config.json';

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function mergeConfig(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = { ...base };
  for (const key of Object.keys(DEFAULTS)) {
    if (override[key] == null) continue;
    if (key === 'layers' && typeof override.layers === 'object') {
      out.layers = { ...base.layers, ...override.layers };
    } else if (key === 'ui' && typeof override.ui === 'object') {
      out.ui = { ...base.ui, ...override.ui };
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

export function globalConfigPath() {
  return path.join(os.homedir(), '.cx', CONFIG_BASENAME);
}

export function projectConfigPath({ cwd = process.cwd() } = {}) {
  return resolveProjectScopedPath(CONFIG_BASENAME, { cwd, ensureDir: false });
}

export function loadChatConfig({ cwd = process.cwd() } = {}) {
  let config = { ...DEFAULTS, layers: { ...DEFAULTS.layers } };
  config = mergeConfig(config, readJson(globalConfigPath()));
  const projectPath = projectConfigPath({ cwd });
  config = mergeConfig(config, readJson(projectPath));
  return { config, path: projectPath };
}

export function saveChatConfig(config, { cwd = process.cwd() } = {}) {
  const target = resolveProjectScopedPath(CONFIG_BASENAME, { cwd, ensureDir: true });
  const persisted = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] == null) continue;
    persisted[key] = key === 'layers' ? { ...config.layers } : key === 'ui' ? { ...config.ui } : config[key];
  }
  fs.writeFileSync(target, `${JSON.stringify(persisted, null, 2)}\n`);
  return target;
}

// Validates and coerces a single `key value` setting change. Returns
// { ok, value, error } so the command layer can report precisely.

export function validateSetting(key, rawValue) {
  switch (key) {
    case 'host':
      return { ok: true, value: String(rawValue) };
    case 'model':
      return { ok: true, value: String(rawValue) };
    case 'thinking': {
      const v = parseBool(rawValue);
      return v == null ? { ok: false, error: 'thinking must be on/off' } : { ok: true, value: v };
    }
    case 'permissionMode':
    case 'permission':
      return PERMISSION_MODES.includes(rawValue)
        ? { ok: true, key: 'permissionMode', value: rawValue }
        : { ok: false, error: `permission must be one of: ${PERMISSION_MODES.join(', ')}` };
    case 'sandbox':
      return SANDBOX_LEVELS.includes(rawValue)
        ? { ok: true, value: rawValue }
        : { ok: false, error: `sandbox must be one of: ${SANDBOX_LEVELS.join(', ')}` };
    case 'ascii': {
      const v = parseBool(rawValue);
      return v == null ? { ok: false, error: 'ascii must be on/off' } : { ok: true, key: 'ui.ascii', value: v };
    }
    case 'inspector':
      return INSPECTOR_MODES.includes(String(rawValue).toLowerCase())
        ? { ok: true, key: 'ui.inspector', value: String(rawValue).toLowerCase() }
        : { ok: false, error: `inspector must be one of: ${INSPECTOR_MODES.join(', ')}` };
    case 'theme':
      return THEME_MODES.includes(String(rawValue).toLowerCase())
        ? { ok: true, key: 'ui.theme', value: String(rawValue).toLowerCase() }
        : { ok: false, error: `theme must be one of: ${THEME_MODES.join(', ')}` };
    default:
      if (LAYER_KEYS.includes(key)) {
        const v = parseBool(rawValue);
        return v == null ? { ok: false, error: `${key} must be on/off` } : { ok: true, key: `layers.${key}`, value: v };
      }
      return { ok: false, error: `unknown setting: ${key}` };
  }
}

function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v).toLowerCase();
  if (['on', 'true', '1', 'yes', 'show'].includes(s)) return true;
  if (['off', 'false', '0', 'no', 'hide'].includes(s)) return false;
  return null;
}
