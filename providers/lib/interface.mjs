/**
 * providers/lib/interface.mjs — abstract provider interface and validation.
 *
 * Every provider must export an object matching this shape. The validate()
 * function checks a provider at registration time; capability dispatch
 * uses hasCapability() before calling.
 */

const CAPABILITIES = ['read', 'write', 'search', 'watch', 'webhook'];

/**
 * Validate a provider object against the interface contract.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validate(provider) {
  const errors = [];

  if (!provider || typeof provider !== 'object') {
    return { valid: false, errors: ['Provider must be a non-null object'] };
  }
  if (typeof provider.name !== 'string' || !provider.name) {
    errors.push('Provider must have a non-empty string "name"');
  }
  if (!Array.isArray(provider.capabilities)) {
    errors.push('Provider must declare "capabilities" as an array');
  } else {
    for (const cap of provider.capabilities) {
      if (!CAPABILITIES.includes(cap)) {
        errors.push(`Unknown capability "${cap}". Valid: ${CAPABILITIES.join(', ')}`);
      }
      if (typeof provider[cap] !== 'function') {
        errors.push(`Provider declares capability "${cap}" but does not implement it as a function`);
      }
    }
  }
  if (typeof provider.init !== 'function') {
    errors.push('Provider must implement init(config)');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a provider supports a given capability.
 */
export function hasCapability(provider, capability) {
  return Array.isArray(provider.capabilities) && provider.capabilities.includes(capability);
}

export { CAPABILITIES };
