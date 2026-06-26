/**
 * lib/config/legacy-config-migration.mjs — one-time forward migration from the
 * pre-XDG ~/.construct/config.env into the active XDG config dir.
 *
 * Model tier overrides and credential pointers/keys stranded by the clean break
 * (ADR-0045) are mirrored forward without overwriting values already in XDG.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEnvFile, writeEnvValues } from '../env-config.mjs';
import { API_KEY_CREDENTIALS } from '../providers/credential-catalog.mjs';
import { configDir } from './xdg.mjs';

const MIGRATABLE_MODEL_KEY = /^(?:CX|CONSTRUCT)_MODEL_[A-Z0-9_]+$/;
const MIGRATABLE_POINTER_KEYS = new Set(['CONSTRUCT_OP_ENV_FILE']);
const CREDENTIAL_ENV_KEYS = new Set(
  API_KEY_CREDENTIALS.flatMap((entry) => entry.envVars),
);

export function legacyConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.construct', 'config.env');
}

function xdgConfigPath(homeDir, env) {
  return path.join(configDir(homeDir, env), 'config.env');
}

function expandHomePath(file, home) {
  if (file === '~') return home;
  if (file.startsWith('~/')) return `${home}${file.slice(1)}`;
  return file;
}

function migrateKeysFromLegacy({ legacyEnv, xdgEnv, keyFilter }) {
  const migrated = {};
  for (const [key, value] of Object.entries(legacyEnv)) {
    if (!keyFilter(key)) continue;
    if (value === '' || value === undefined) continue;
    if (xdgEnv[key] !== undefined && xdgEnv[key] !== '') continue;
    migrated[key] = value;
  }
  return migrated;
}

function backfillFromOpEnvCatalog({ migrated, xdgEnv, homeDir }) {
  const pointer = migrated.CONSTRUCT_OP_ENV_FILE
    || xdgEnv.CONSTRUCT_OP_ENV_FILE
    || legacyEnvPointer(homeDir);
  if (!pointer) return migrated;

  const catalogPath = expandHomePath(pointer.replace(/^["']|["']$/g, ''), homeDir);
  if (!fs.existsSync(catalogPath)) return migrated;

  const catalog = parseEnvFile(catalogPath);
  const next = { ...migrated };
  for (const key of CREDENTIAL_ENV_KEYS) {
    if (xdgEnv[key] || next[key]) continue;
    if (!catalog[key]) continue;
    next[key] = catalog[key];
  }
  return next;
}

function legacyEnvPointer(homeDir) {
  const legacy = parseEnvFile(legacyConfigPath(homeDir));
  return legacy.CONSTRUCT_OP_ENV_FILE || null;
}

/**
 * Migrate stranded CX_MODEL_ and CONSTRUCT_MODEL_ tier overrides from legacy
 * config into XDG config.env.
 */
export function migrateLegacyModelConfig({ homeDir = os.homedir(), env = process.env } = {}) {
  const legacyPath = legacyConfigPath(homeDir);
  const xdgPath = xdgConfigPath(homeDir, env);
  const result = { performed: false, migrated: {}, legacyPath, xdgPath };

  if (legacyPath === xdgPath || !fs.existsSync(legacyPath)) return result;

  const legacyEnv = parseEnvFile(legacyPath);
  const xdgEnv = parseEnvFile(xdgPath);
  const migrated = migrateKeysFromLegacy({
    legacyEnv,
    xdgEnv,
    keyFilter: (key) => MIGRATABLE_MODEL_KEY.test(key),
  });

  if (Object.keys(migrated).length === 0) return result;

  writeEnvValues(xdgPath, migrated);
  result.performed = true;
  result.migrated = migrated;
  return result;
}

/**
 * Migrate CONSTRUCT_OP_ENV_FILE and API-key env vars from legacy config, then
 * backfill any still-missing credential keys from the referenced op-run catalog.
 */
export function migrateLegacyCredentialConfig({ homeDir = os.homedir(), env = process.env } = {}) {
  const legacyPath = legacyConfigPath(homeDir);
  const xdgPath = xdgConfigPath(homeDir, env);
  const result = { performed: false, migrated: {}, legacyPath, xdgPath };

  if (legacyPath === xdgPath || !fs.existsSync(legacyPath)) return result;

  const legacyEnv = parseEnvFile(legacyPath);
  const xdgEnv = parseEnvFile(xdgPath);
  let migrated = migrateKeysFromLegacy({
    legacyEnv,
    xdgEnv,
    keyFilter: (key) => MIGRATABLE_POINTER_KEYS.has(key) || CREDENTIAL_ENV_KEYS.has(key),
  });
  migrated = backfillFromOpEnvCatalog({ migrated, xdgEnv, homeDir });

  if (Object.keys(migrated).length === 0) return result;

  writeEnvValues(xdgPath, migrated);
  result.performed = true;
  result.migrated = migrated;
  return result;
}
