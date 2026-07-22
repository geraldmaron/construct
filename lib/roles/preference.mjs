/**
 * lib/roles/preference.mjs — per-user primary/secondary role preferences.
 *
 * Persists role preferences to ~/.construct/config.env under the keys
 * CONSTRUCT_ROLE_PRIMARY and CONSTRUCT_ROLE_SECONDARY. Consumed by the
 * `roles:set` CLI command and the orchestration layer.
 */

import os from 'node:os';
import path from 'node:path';

import { getUserEnvPath, ensureUserConfigDir, writeEnvValues, parseEnvFile } from '../env-config.mjs';

const ENV_KEYS = {
  primary: 'CONSTRUCT_ROLE_PRIMARY',
  secondary: 'CONSTRUCT_ROLE_SECONDARY',
};

/**
 * Read the stored role preference for the given slot.
 *
 * @param {'primary'|'secondary'} slot
 * @returns {string|null}  The stored role id, or null if unset.
 */
export function getRolePreference(slot) {
  const envKey = ENV_KEYS[slot];
  if (!envKey) return null;

  // Env var takes priority (allows per-session override)
  if (process.env[envKey]) return process.env[envKey];

  const envPath = getUserEnvPath(os.homedir());
  const stored = parseEnvFile(envPath);
  return stored[envKey] || null;
}

/**
 * Persist a role preference for the given slot.
 *
 * @param {'primary'|'secondary'} slot
 * @param {string} role  Role id (e.g. "engineer"). Accepts retired `cx-` prefix and strips it.
 * @returns {{ slot: string, role: string }}
 */
export function setRolePreference(slot, role) {
  const envKey = ENV_KEYS[slot];
  if (!envKey) throw new Error(`Unknown role slot "${slot}". Use "primary" or "secondary".`);

  const normalised = String(role || '').replace(/^cx-/, '');
  if (!normalised) throw new Error('Role id must be a non-empty Worker Profile id.');

  ensureUserConfigDir(os.homedir());
  const envPath = getUserEnvPath(os.homedir());
  writeEnvValues(envPath, { [envKey]: normalised });

  process.env[envKey] = normalised;

  return { slot, role: normalised };
}

/**
 * Clear a stored role preference.
 *
 * @param {'primary'|'secondary'} slot
 */
export function clearRolePreference(slot) {
  const envKey = ENV_KEYS[slot];
  if (!envKey) return;

  delete process.env[envKey];

  const envPath = getUserEnvPath(os.homedir());
  writeEnvValues(envPath, { [envKey]: '' });
}
