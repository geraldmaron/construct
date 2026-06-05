/**
 * lib/model-registry.mjs — Single source of truth for model tier resolution.
 *
 * Addresses model tier complexity by:
 * 1. ONE resolution path with clear precedence
 * 2. Validated at config time, not runtime
 * 3. Simple env-only overrides for emergencies
 * 4. Clear error messages when config is missing
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration precedence (single source of truth)
// ---------------------------------------------------------------------------

/**
 * RESOLUTION ORDER (highest to lowest):
 * 1. Environment variables (CX_MODEL_*): Emergency overrides
 * 2. User config (~/.construct/config.env): Personal defaults
 * 3. Registry (specialists/registry.json): Project recommendations
 *
 * Construct ships with NO implicit model defaults (ADR-0027,
 * tests/model-router-no-defaults.test.mjs). When none of the three sources
 * resolves a tier, that tier returns null with source 'not configured'.
 * Callers must surface a clear remediation hint rather than silently
 * substituting a vendor-specific default.
 */

const ENV_PREFIX = 'CX_MODEL';

// ---------------------------------------------------------------------------
// Core resolution function
// ---------------------------------------------------------------------------

export function resolveModelTiers(options = {}) {
  const { 
    env = process.env,
    registryPath = null,
    strict = false,  // If true, require all tiers to be configured
  } = options;
  
  const result = {
    reasoning: null,
    standard: null,
    fast: null,
  };
  
  const sources = {};
  const errors = [];
  
  for (const tier of ['reasoning', 'standard', 'fast']) {
    const envKey = `${ENV_PREFIX}_${tier.toUpperCase()}`;
    
    // Environment variable (highest priority)
    if (env[envKey]) {
      result[tier] = env[envKey];
      sources[tier] = 'env';
      continue;
    }
    
    // User config (read from env which was loaded by env-config)
    const configKey = `CONSTRUCT_MODEL_${tier.toUpperCase()}`;
    if (env[configKey]) {
      result[tier] = env[configKey];
      sources[tier] = 'config';
      continue;
    }
    
    // Registry
    if (registryPath && fs.existsSync(registryPath)) {
      try {
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        const registryModel = registry.models?.[tier]?.primary;
        if (registryModel) {
          result[tier] = registryModel;
          sources[tier] = 'registry';
          continue;
        }
      } catch (error) {
        errors.push(`Failed to read registry: ${error.message}`);
      }
    }
    
    // No source resolved this tier — leave null + 'not configured' so callers
    // can surface a clear remediation hint. Aligns with the wired path
    // (lib/model-router.mjs:resolveTierAssignments) and the no-defaults
    // contract locked in by tests/model-router-no-defaults.test.mjs.

    result[tier] = null;
    sources[tier] = 'not configured';
  }

  const configured = Object.values(result).filter(Boolean).length;

  if (strict && configured < 3) {
    const missing = Object.entries(result)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    errors.push(`Missing configuration for tiers: ${missing.join(', ')}`);
  }

  return {
    models: result,
    sources,
    configured,
    complete: configured === 3,
    errors: errors.length > 0 ? errors : null,
  };
}

// ---------------------------------------------------------------------------
// Quick access helpers
// ---------------------------------------------------------------------------

export function getModelForTier(tier, options = {}) {
  const resolved = resolveModelTiers(options);
  return resolved.models[tier];
}

export function getModelSource(tier, options = {}) {
  const resolved = resolveModelTiers(options);
  return resolved.sources[tier] || 'unknown';
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function validateModelTiers(options = {}) {
  const resolved = resolveModelTiers({ ...options, strict: true });
  const unconfigured = Object.entries(resolved.sources)
    .filter(([, source]) => source === 'not configured')
    .map(([tier]) => tier);

  return {
    valid: resolved.complete && !resolved.errors,
    errors: resolved.errors,
    warnings: unconfigured.length > 0
      ? [`Unconfigured tier${unconfigured.length === 1 ? '' : 's'}: ${unconfigured.join(', ')}. Run 'construct models --apply' or set CX_MODEL_<TIER>.`]
      : [],
    resolution: resolved,
  };
}

export function formatModelStatus(options = {}) {
  const resolved = resolveModelTiers(options);

  let output = 'Model Configuration:\n\n';

  for (const tier of ['reasoning', 'standard', 'fast']) {
    const model = resolved.models[tier];
    const source = resolved.sources[tier];
    const icon = source === 'not configured' ? '⚠' : '✓';
    const display = model ?? '(not configured)';

    output += `${icon} ${tier.padEnd(10)} ${display}\n`;
    output += `  Source: ${source}\n\n`;
  }

  const unconfigured = Object.entries(resolved.sources)
    .filter(([, source]) => source === 'not configured')
    .map(([tier]) => tier);
  if (unconfigured.length > 0) {
    output += `\nUnconfigured: ${unconfigured.join(', ')}. To configure:\n`;
    output += '  construct models --apply        (interactive, picks from available providers)\n';
    output += '  export CX_MODEL_REASONING=...   (env override)\n';
    output += '  export CX_MODEL_STANDARD=...\n';
    output += '  export CX_MODEL_FAST=...\n';
  }

  return output;
}

// ---------------------------------------------------------------------------
// Backwards compatibility
// ---------------------------------------------------------------------------

/**
 * Legacy wrapper for code that expects the old interface.
 * New code should use resolveModelTiers() directly.
 */
export function readCurrentModels(envPath, registryModels = {}) {
  // Maintains backwards compatibility with existing code
  // while using the new resolution logic internally
  
  const env = {};
  
  // Load from env file if provided
  if (envPath && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    }
  }
  
  // Merge with process.env
  Object.assign(env, process.env);
  
  const resolved = resolveModelTiers({ env });
  
  // Return in legacy format
  return {
    reasoning: resolved.models.reasoning,
    standard: resolved.models.standard,
    fast: resolved.models.fast,
    // Legacy code expects these fields
    _resolved: resolved,
  };
}

export function setTierModel(tier, model, envPath) {
  // Simplified interface for setting a model
  // In practice, this should update the user config file
  
  if (!['reasoning', 'standard', 'fast'].includes(tier)) {
    throw new Error(`Invalid tier: ${tier}. Must be reasoning, standard, or fast.`);
  }
  
  const envKey = `${ENV_PREFIX}_${tier.toUpperCase()}`;
  
  return {
    success: true,
    tier,
    model,
    envKey,
    instruction: `Add to your shell profile: export ${envKey}="${model}"`,
  };
}
