/**
 * lib/env-config.mjs — Read and write Construct environment configuration files.
 *
 * Provides helpers to load ~/.cx/env, merge with process.env, and persist
 * key/value pairs back to disk. Backs setup, model-router, and the MCP
 * server when they resolve API keys and model overrides without leaking secrets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  return path.join(homeDir, '.construct');
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
  const fileEnv = { ...rootEnv, ...userEnv };

  if (warn) {
    for (const key of Object.keys(env)) {
      if (ENV_SHADOW_IGNORE.has(key)) continue;
      if (!ENV_SHADOW_WARN.has(key)) continue;
      // Only warn when process.env has a non-empty competing value.
      // An empty-string env var (e.g. Claude for Desktop clears ANTHROPIC_API_KEY
      // so its internal auth is used instead) is not a real conflict — config.env wins
      // silently and no user action is needed.
      if (!env[key]) continue;
      if (key in fileEnv && fileEnv[key] !== env[key]) {
        if (preferInjectedCredential(env[key], fileEnv[key])) continue;
        process.stderr.write(
          `[construct] WARNING: process.env.${key} (${env[key].slice(0, 6)}…) ` +
          `differs from config.env value (${fileEnv[key].slice(0, 6)}…). ` +
          `config.env will be used. To silence: unset the shell variable or ` +
          `update ~/.construct/config.env to match.\n`,
        );
      }
    }
  }

  // process.env is the base; config.env (file) values override shell values
  // so that credentials set in the dashboard always win over stale shell exports.
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
