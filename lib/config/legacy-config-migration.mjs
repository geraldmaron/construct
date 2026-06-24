/**
 * lib/config/legacy-config-migration.mjs — one-time forward migration of model
 * tier overrides from the pre-XDG legacy config into the active XDG config.
 *
 * The config move to $XDG_CONFIG_HOME/construct (see lib/config/xdg.mjs) is a
 * clean break with no legacy read, so any install that set CX_MODEL_* before
 * the move keeps those values stranded in ~/.construct/config.env. Resolution
 * reads only the XDG path, so doctor then reports "no tier configured" until
 * the user hand-copies the keys. This mirrors the stranded tier overrides
 * forward, and never overwrites a value the XDG config already defines.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEnvFile, writeEnvValues } from '../env-config.mjs';
import { configDir } from './xdg.mjs';

// Only model tier overrides migrate. API keys and other secrets are
// intentionally out of scope — they are re-established through the credential
// bootstrap, not copied between paths.

const MIGRATABLE_KEY = /^(?:CX|CONSTRUCT)_MODEL_[A-Z0-9_]+$/;

export function legacyConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.construct', 'config.env');
}

/**
 * Migrate stranded CX_MODEL_ and CONSTRUCT_MODEL_ tier overrides from the
 * legacy config into the XDG config. Returns the keys that were written so
 * callers can surface a one-time message and refresh their in-process env.
 */
export function migrateLegacyModelConfig({ homeDir = os.homedir(), env = process.env } = {}) {
  const legacyPath = legacyConfigPath(homeDir);
  const xdgPath = path.join(configDir(homeDir, env), 'config.env');
  const result = { performed: false, migrated: {}, legacyPath, xdgPath };

  if (legacyPath === xdgPath || !fs.existsSync(legacyPath)) return result;

  const legacyEnv = parseEnvFile(legacyPath);
  const xdgEnv = parseEnvFile(xdgPath);

  const migrated = {};
  for (const [key, value] of Object.entries(legacyEnv)) {
    if (!MIGRATABLE_KEY.test(key)) continue;
    if (value === '' || value === undefined) continue;
    if (xdgEnv[key] !== undefined && xdgEnv[key] !== '') continue;
    migrated[key] = value;
  }

  if (Object.keys(migrated).length === 0) return result;

  writeEnvValues(xdgPath, migrated);
  result.performed = true;
  result.migrated = migrated;
  return result;
}
