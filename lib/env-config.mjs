/**
 * lib/env-config.mjs — Read and write Construct environment configuration files.
 *
 * Provides helpers to load ~/.cx/env, merge with process.env, and persist
 * key/value pairs back to disk. Used by setup, model-router, and the MCP
 * server to resolve API keys and model overrides without leaking secrets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// Keys that are expected to be set in process.env and should not trigger
// shadow warnings (e.g. standard Node/shell vars, CI variables).
const ENV_SHADOW_IGNORE = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'PWD', 'OLDPWD', 'LOGNAME',
  'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SHLVL', '_',
  'NODE_ENV', 'NODE_PATH', 'NODE_OPTIONS',
  'npm_lifecycle_event', 'npm_package_name', 'npm_package_version',
]);

/**
 * Keys used to configure Construct services. When process.env provides one
 * of these and a .env file also sets it to a *different* value, we emit a
 * one-time warning so stale exported vars are not silently authoritative.
 */
const ENV_SHADOW_WARN = new Set([
  'LANGFUSE_BASEURL', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
  'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'DASHBOARD_PORT', 'MEMORY_PORT', 'BRIDGE_PORT',
]);

export function loadConstructEnv({ rootDir, homeDir = os.homedir(), env = process.env, warn = true } = {}) {
  const rootEnv = rootDir ? parseEnvFile(path.join(rootDir, '.env')) : {};
  const userEnv = parseEnvFile(getUserEnvPath(homeDir));
  const fileEnv = { ...rootEnv, ...userEnv };

  if (warn) {
    for (const key of Object.keys(env)) {
      if (ENV_SHADOW_IGNORE.has(key)) continue;
      if (!ENV_SHADOW_WARN.has(key)) continue;
      if (key in fileEnv && fileEnv[key] !== env[key]) {
        process.stderr.write(
          `[construct] WARNING: process.env.${key} (${env[key].slice(0, 6)}…) shadows ` +
          `config.env value (${fileEnv[key].slice(0, 6)}…). ` +
          `Unset the shell variable or update ~/.construct/config.env.\n`,
        );
      }
    }
  }

  return { ...fileEnv, ...env };
}
