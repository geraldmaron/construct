/**
 * providers/lib/registry.mjs — load and manage provider instances.
 *
 * Reads provider config from .cx/providers.yaml (or programmatic config),
 * validates each provider against the interface contract, and provides
 * a dispatch surface for core.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validate, hasCapability } from './interface.mjs';
import { CapabilityNotSupported } from './errors.mjs';

/**
 * In-memory provider registry.
 */
export class ProviderRegistry {
  #providers = new Map();

  /**
   * Register a provider instance. Validates against the interface contract.
   * Throws if validation fails.
   */
  register(provider) {
    const result = validate(provider);
    if (!result.valid) {
      throw new Error(`Invalid provider "${provider?.name ?? '(unnamed)'}": ${result.errors.join('; ')}`);
    }
    this.#providers.set(provider.name, provider);
  }

  /**
   * Get a registered provider by name.
   */
  get(name) {
    return this.#providers.get(name) ?? null;
  }

  /**
   * List all registered provider names.
   */
  list() {
    return [...this.#providers.keys()];
  }

  /**
   * List providers that support a given capability.
   */
  withCapability(capability) {
    return [...this.#providers.values()].filter((p) => hasCapability(p, capability));
  }

  /**
   * Dispatch a capability call to a named provider.
   * Throws CapabilityNotSupported if the provider doesn't implement it.
   */
  async dispatch(providerName, capability, ...args) {
    const provider = this.#providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" not registered`);
    }
    if (!hasCapability(provider, capability)) {
      throw new CapabilityNotSupported(providerName, capability);
    }
    return provider[capability](...args);
  }

  /**
   * Initialize all registered providers with their configs.
   */
  async initAll(configs = {}) {
    const results = [];
    for (const [name, provider] of this.#providers) {
      try {
        await provider.init(configs[name] ?? {});
        results.push({ name, status: 'ready' });
      } catch (err) {
        results.push({ name, status: 'error', error: err.message });
      }
    }
    return results;
  }
}

/**
 * Load provider config from a YAML file.
 * Returns parsed config or null if file doesn't exist.
 * Note: requires a YAML parser — deferred to avoid adding deps to provider lib.
 * For now, returns raw file content for the caller to parse.
 */
export function loadProviderConfigFile(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.cx', 'providers.yaml'),
    path.join(projectRoot, '.cx', 'providers.yml'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, raw: fs.readFileSync(candidate, 'utf8') };
    }
  }
  return null;
}
