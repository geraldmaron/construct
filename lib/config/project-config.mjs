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
import { CONFIG_SCHEMA_VERSION, DEFAULT_PROJECT_CONFIG, validateProjectConfig, FIELD_RULES } from './schema.mjs';
import { validateSourceTargets } from './source-targets.mjs';

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
  const targetErrors = raw?.sources?.targets !== undefined
    ? validateSourceTargets(raw.sources.targets)
    : [];
  const allErrors = [...(validation.errors ?? []), ...targetErrors];
  if (!validation.valid || targetErrors.length) {
    return {
      path: configPath,
      raw,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: 'invalid',
      errors: allErrors,
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

export function writeProjectConfig(filePath, config, options = {}) {
  const { 
    validate = true,           // Perform validation before write
    interactive = false,       // Prompt for fixes in interactive mode
    dryRun = false,           // Validate only, don't write
    strict = false,           // Reject unknown fields
  } = options;
  
  // Pre-validation: Check for common mistakes
  const preErrors = [];
  const warnings = [];
  
  // Check 1: Version mismatch
  if (config.version && config.version !== CONFIG_SCHEMA_VERSION) {
    preErrors.push(`version mismatch: file has v${config.version}, expected v${CONFIG_SCHEMA_VERSION}`);
  }
  
  // Check 2: Unknown top-level fields (warning in non-strict mode)
  if (typeof config === 'object' && config !== null) {
    const knownFields = Object.keys(FIELD_RULES);
    const unknownFields = Object.keys(config).filter(k => !knownFields.includes(k));
    if (unknownFields.length > 0) {
      const msg = `unknown fields will be ignored: ${unknownFields.join(', ')}`;
      if (strict) {
        preErrors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }
  
  // Check 3: Secret literals (security warning)
  const secretPattern = /(api[_-]?key|token|secret|password)/i;
  function findSecretLiterals(obj, path = '') {
    const found = [];
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (secretPattern.test(key) && typeof value === 'string' && !value.startsWith('$')) {
        found.push(currentPath);
      }
      if (typeof value === 'object' && value !== null) {
        found.push(...findSecretLiterals(value, currentPath));
      }
    }
    return found;
  }
  
  const secretPaths = findSecretLiterals(config);
  if (secretPaths.length > 0) {
    warnings.push(`potential secrets detected at: ${secretPaths.join(', ')}. Use "$ENV_VAR" syntax instead.`);
  }
  
  // Run full schema validation
  let validation = { valid: true, errors: [] };
  if (validate) {
    validation = validateProjectConfig(config);
    if (config?.sources?.targets !== undefined) {
      validation.errors = [...(validation.errors ?? []), ...validateSourceTargets(config.sources.targets)];
      validation.valid = validation.errors.length === 0;
    }
  }
  
  // Combine all errors (handle case where validation.errors is undefined)
  const validationErrors = validation.errors || [];
  const allErrors = [...preErrors, ...validationErrors];
  
  // Build comprehensive feedback
  const feedback = {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings,
    filePath,
    wouldWrite: !dryRun && allErrors.length === 0,
  };
  
  // Throw on validation errors
  if (allErrors.length > 0) {
    const errorMessage = formatValidationErrors(allErrors, warnings, filePath);
    throw new Error(errorMessage);
  }
  
  // Log warnings
  if (warnings.length > 0 && !options.silent) {
    console.error('Config warnings:');
    warnings.forEach(w => console.error(`  ⚠ ${w}`));
  }
  
  // Perform dry-run or actual write
  if (dryRun) {
    feedback.written = false;
    return feedback;
  }
  
  // Write the file
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
  
  feedback.written = true;
  return feedback;
}

function formatValidationErrors(errors, warnings, filePath) {
  let msg = `refusing to write invalid config: ${errors.join('; ')}`;
  msg += `\n\nInvalid config (${filePath}):\n\n`;
  
  msg += 'Errors:\n';
  errors.forEach(e => {
    msg += `  ✗ ${e}\n`;
  });
  
  if (warnings.length > 0) {
    msg += '\nWarnings:\n';
    warnings.forEach(w => {
      msg += `  ⚠ ${w}\n`;
    });
  }
  
  msg += '\nFix these issues before the config can be saved.';
  msg += '\nRun with --dry-run to validate without writing.';
  
  return msg;
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

/**
 * Set a config value with immediate validation and feedback.
 * Recommended way to update configuration from CLI/commands.
 * 
 * @param {string} keyPath - Dot-notation path (e.g., 'deployment.mode')
 * @param {any} value - Value to set
 * @param {Object} options
 * @returns {Object} Validation result with immediate feedback
 */
export function setConfigValueWithValidation(keyPath, value, options = {}) {
  const { cwd = process.cwd(), dryRun = false } = options;
  
  // Load current config
  const current = loadProjectConfig(cwd);
  const configPath = current.path || path.join(cwd, PROJECT_CONFIG_FILENAME);
  
  // Apply the change
  const newConfig = setConfigValue(current.config, keyPath, value);
  
  // Validate before writing
  const validation = validateProjectConfig(newConfig);
  
  if (!validation.valid) {
    return {
      success: false,
      keyPath,
      value,
      errors: validation.errors,
      message: `Cannot set ${keyPath}: validation failed`,
    };
  }
  
  // Write if not dry-run
  if (!dryRun) {
    try {
      writeProjectConfig(configPath, newConfig, { validate: true });
      return {
        success: true,
        keyPath,
        value,
        configPath,
        message: `Set ${keyPath} = ${JSON.stringify(value)}`,
      };
    } catch (error) {
      return {
        success: false,
        keyPath,
        value,
        errors: [error.message],
        message: `Failed to write config: ${error.message}`,
      };
    }
  }
  
  // Dry-run mode
  return {
    success: true,
    keyPath,
    value,
    dryRun: true,
    message: `Would set ${keyPath} = ${JSON.stringify(value)} (dry-run)`,
  };
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
