/**
 * lib/config/project-config.mjs — read and write construct.config.json.
 *
 * Source-of-truth loader for project-level Construct settings. Resolves
 * the path by walking up from cwd (stops at git root or filesystem root),
 * validates against the v1 schema, and applies secret interpolation:
 * any string value of the form `$VAR_NAME` is replaced with the
 * corresponding env-var value at load time. Pointers keep API keys in
 * `.env` where they belong; the JSON config never sees a secret literal.
 *
 * Precedence rule for consumers: env var if set > config.json > default.
 * `resolveSetting(config, jsonPath, env, envKey, default)` encodes it
 * once so call sites stay consistent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_SCHEMA_VERSION, DEFAULT_PROJECT_CONFIG, validateProjectConfig } from './schema.mjs';

export const PROJECT_CONFIG_FILENAME = 'construct.config.json';

export function findProjectConfigPath(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, PROJECT_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git'))) {
      const inGitRoot = path.join(dir, PROJECT_CONFIG_FILENAME);
      return fs.existsSync(inGitRoot) ? inGitRoot : null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

const ENV_POINTER_RE = /^\$([A-Z_][A-Z0-9_]*)$/;

export function interpolateSecrets(value, env = process.env) {
  if (typeof value === 'string') {
    const match = value.match(ENV_POINTER_RE);
    if (!match) return value;
    const resolved = env[match[1]];
    return resolved === undefined ? null : resolved;
  }
  if (Array.isArray(value)) return value.map((v) => interpolateSecrets(v, env));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateSecrets(v, env);
    return out;
  }
  return value;
}

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (override === null || typeof override !== 'object' || Array.isArray(override)) return override;
  const out = Array.isArray(base) ? [...(base || [])] : { ...(base || {}) };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(base?.[k], v);
  }
  return out;
}

export function loadProjectConfig(cwd = process.cwd(), env = process.env) {
  const configPath = findProjectConfigPath(cwd);
  if (!configPath) {
    return {
      path: null,
      raw: null,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: 'default',
      errors: [],
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    return {
      path: configPath,
      raw: null,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: 'invalid',
      errors: [`failed to parse ${configPath}: ${err.message}`],
    };
  }
  const validation = validateProjectConfig(raw);
  if (!validation.valid) {
    return {
      path: configPath,
      raw,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: 'invalid',
      errors: validation.errors,
    };
  }
  const merged = deepMerge(structuredClone(DEFAULT_PROJECT_CONFIG), raw);
  const resolved = interpolateSecrets(merged, env);
  return {
    path: configPath,
    raw,
    config: resolved,
    source: 'file',
    errors: [],
  };
}

export function writeProjectConfig(filePath, config) {
  const validation = validateProjectConfig(config);
  if (!validation.valid) {
    throw new Error(`refusing to write invalid config: ${validation.errors.join('; ')}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

export function initProjectConfig(cwd = process.cwd(), overrides = {}) {
  const filePath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  if (fs.existsSync(filePath)) {
    throw new Error(`${PROJECT_CONFIG_FILENAME} already exists at ${filePath}`);
  }
  const config = deepMerge(structuredClone(DEFAULT_PROJECT_CONFIG), { version: CONFIG_SCHEMA_VERSION, ...overrides });
  writeProjectConfig(filePath, config);
  return filePath;
}

export function getConfigValue(config, keyPath, defaultValue) {
  if (!keyPath) return config;
  const parts = keyPath.split('.');
  let cur = config;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return defaultValue;
    cur = cur[part];
  }
  return cur === undefined ? defaultValue : cur;
}

export function setConfigValue(config, keyPath, value) {
  if (!keyPath) throw new Error('keyPath required');
  const parts = keyPath.split('.');
  const out = structuredClone(config);
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
  return out;
}

export function resolveSetting({ config, jsonPath, env, envKey, defaultValue }) {
  if (env && envKey && env[envKey] !== undefined && env[envKey] !== '') {
    return { value: env[envKey], source: 'env', envKey };
  }
  const fromJson = getConfigValue(config, jsonPath, undefined);
  if (fromJson !== undefined && fromJson !== null) {
    return { value: fromJson, source: 'config', jsonPath };
  }
  return { value: defaultValue, source: 'default' };
}
