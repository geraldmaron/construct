/**
 * lib/env-config.mjs — Read and write Construct environment configuration files.
 *
 * Provides helpers to load the user config.env (XDG config dir) and a project
 * .env, merge them with process.env, and persist key/value pairs back to disk.
 * Project .env wins over user config.env, which wins over shell exports. Backs
 * setup, model-router, and the MCP server when they resolve API keys and model
 * overrides without leaking secrets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from './config/xdg.mjs';
import { API_KEY_CREDENTIALS } from './providers/credential-catalog.mjs';
import { extractOpRef } from './providers/secret-resolver.mjs';

export function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return env;
}

export function getUserConfigDir(homeDir = os.homedir()) {
  return configDir(homeDir);
}

export function getUserEnvPath(homeDir = os.homedir()) {
  return path.join(getUserConfigDir(homeDir), 'config.env');
}

export function ensureUserConfigDir(homeDir = os.homedir()) {
  const dir = getUserConfigDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeEnvValues(filePath, values = {}) {
  const existing = parseEnvFile(filePath);
  const merged = { ...existing, ...values };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

function cleanEnvValue(value) {
  return String(value ?? '').trim();
}

export function resolveDatabaseUrl(env = process.env) {
  const explicit = cleanEnvValue(env.DATABASE_URL);
  if (explicit) return explicit;

  const host = cleanEnvValue(env.DB_HOST);
  const name = cleanEnvValue(env.DB_NAME);
  const user = cleanEnvValue(env.DB_USER);
  const password = cleanEnvValue(env.DB_PASSWORD);
  const port = cleanEnvValue(env.DB_PORT) || '5432';

  if (!host || !name || !user || !password) return '';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

// Keys that are expected to be set in process.env and should not trigger
// shadow warnings (e.g. standard Node/shell vars, CI variables).
const ENV_SHADOW_IGNORE = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'PWD', 'OLDPWD', 'LOGNAME',
  'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SHLVL', '_',
  'NODE_ENV', 'NODE_PATH', 'NODE_OPTIONS',
  'npm_lifecycle_event', 'npm_package_name', 'npm_package_version',
]);

/**
 * Keys that configure Construct services. When process.env provides one
 * of these and a .env file also sets it to a *different* value, a one-time
 * warning fires so stale exported vars are not silently authoritative.
 */
const ENV_SHADOW_WARN = new Set([
  'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'DASHBOARD_PORT', 'MEMORY_PORT', 'BRIDGE_PORT',
  'CONSTRUCT_INSTANCE_ID',
  'CONSTRUCT_DEPLOYMENT_MODE',
]);

const CREDENTIAL_ENV_KEYS = new Set(
  API_KEY_CREDENTIALS.flatMap((entry) => entry.envVars),
);

function isOpReference(value) {
  return Boolean(extractOpRef(value));
}

function preferInjectedCredential(envValue, fileValue) {
  return Boolean(
    envValue
    && !isOpReference(envValue)
    && isOpReference(fileValue),
  );
}

export function loadConstructEnv({ rootDir, homeDir = os.homedir(), env = process.env, warn = true } = {}) {
  const rootEnv = rootDir ? parseEnvFile(path.join(rootDir, '.env')) : {};
  const userEnv = parseEnvFile(getUserEnvPath(homeDir));

  // Most-specific config wins: project .env overrides user config.env, which
  // overrides shell exports. A repo's local .env is closer to the work than a
  // machine-wide default, so it takes the file-tier precedence.
  const fileEnv = { ...userEnv, ...rootEnv };
  const userEnvPath = getUserEnvPath(homeDir);

  if (warn) {
    // Every key that both files define to a different value is a real shadow:
    // project .env silently wins, so surface it rather than gating on a
    // hardcoded credential subset.
    for (const key of Object.keys(rootEnv)) {
      if (!(key in userEnv)) continue;
      if (rootEnv[key] === userEnv[key]) continue;
      if (preferInjectedCredential(rootEnv[key], userEnv[key])) continue;
      process.stderr.write(
        `[construct] WARNING: ${key} is set in both project .env (${rootEnv[key].slice(0, 6)}…) ` +
        `and ${userEnvPath} (${userEnv[key].slice(0, 6)}…). ` +
        `Project .env wins. To silence: remove the key from one file.\n`,
      );
    }

    for (const key of Object.keys(env)) {
      if (ENV_SHADOW_IGNORE.has(key)) continue;
      if (!ENV_SHADOW_WARN.has(key)) continue;
      // Only warn when process.env has a non-empty competing value.
      // An empty-string env var (e.g. Claude for Desktop clears ANTHROPIC_API_KEY
      // so its internal auth is used instead) is not a real conflict — the file
      // value wins silently and no user action is needed.
      if (!env[key]) continue;
      if (key in fileEnv && fileEnv[key] !== env[key]) {
        if (preferInjectedCredential(env[key], fileEnv[key])) continue;
        process.stderr.write(
          `[construct] WARNING: process.env.${key} (${env[key].slice(0, 6)}…) ` +
          `differs from the config file value (${fileEnv[key].slice(0, 6)}…). ` +
          `The config file will be used. To silence: unset the shell variable or ` +
          `update the config file to match.\n`,
        );
      }
    }
  }

  // process.env is the base; .env-file values override shell values so that
  // credentials set in the dashboard always win over stale shell exports.
  // Materialized credentials from `op run` (or an explicit export) win over stored
  // op:// references so one 1Password auth per invocation is enough.
  const merged = { ...env, ...fileEnv };
  for (const key of CREDENTIAL_ENV_KEYS) {
    if (preferInjectedCredential(env[key], fileEnv[key])) {
      merged[key] = env[key];
    }
  }
  const databaseUrl = resolveDatabaseUrl(merged);
  if (databaseUrl && !cleanEnvValue(merged.DATABASE_URL)) {
    merged.DATABASE_URL = databaseUrl;
  }
  return merged;
}
