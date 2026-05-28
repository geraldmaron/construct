/**
 * lib/providers/contract.mjs — data-source provider contract.
 *
 * A provider integrates Construct with an external system that holds work
 * artefacts: GitHub repos, Jira projects, Confluence spaces, Slack channels,
 * Salesforce orgs, etc. Providers are stateless adapters; durable state
 * (cached search results, last-seen markers, observations distilled from
 * fetched items) lives in core stores, not in the provider.
 *
 * A provider module exports a factory:
 *
 *   export function create(options) {
 *     return {
 *       meta: { id, displayName, capabilities: [...], description },
 *       configSchema: { ... } // JSON-Schema draft 2020-12
 *       health: async (config) => ({ ok, detail }),
 *       read?:    async (config, query) => items[],
 *       search?:  async (config, query) => items[],
 *       watch?:   async (config, callback) => unsubscribe,
 *       write?:   async (config, payload) => result,
 *       webhook?: async (config, request) => ack,
 *     };
 *   }
 *
 * Capabilities are an unordered set drawn from the canonical list in
 * `CAPABILITIES`. A provider declares only what it implements; callers
 * consult `meta.capabilities` and skip optional methods that aren't
 * declared.
 *
 * `assertProviderContract(provider)` runs at registry load time and refuses
 * to accept providers that miss required fields or declare capabilities
 * they don't implement. The check is deliberately loose; providers can
 * extend the shape with extra methods; but it gates the load-bearing
 * fields so a typo in a plugin can't take down the registry.
 *
 * Scope validation: `ALLOWLIST_SCHEMA` declares the allowlist fields
 * supported per provider. `validateAllowlist(providerName, target, config)`
 * checks whether `target` (a repo name, channel ID, project key, etc.) is
 * permitted by the caller's config. When no allowlist fields are set the
 * call is allowed through; when any allowlist field is set the target must
 * satisfy it.
 *
 * Glob matching for `*Glob` fields follows minimatch-style single-segment
 * patterns where `*` matches any sequence of non-slash characters.
 */

export const ALLOWLIST_SCHEMA = Object.freeze({
  github:                 { fields: ['org', 'repoAllowlist', 'repoAllowGlob'] },
  'atlassian-jira':       { fields: ['instance', 'projectAllowlist'] },
  'atlassian-confluence': { fields: ['instance', 'spaceAllowlist'] },
  slack:                  { fields: ['workspace', 'channelAllowlist'] },
  salesforce:             { fields: ['instance', 'objectAllowlist'] },
});

function globMatch(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function validateAllowlist(providerName, target, config = {}) {
  const schema = ALLOWLIST_SCHEMA[providerName];

  // Unknown providers pass through; no schema means no restriction.
  if (!schema) return { allowed: true, reason: 'no allowlist schema for provider' };

  const listFields = schema.fields.filter((f) => f.endsWith('Allowlist'));
  const globFields = schema.fields.filter((f) => f.endsWith('AllowGlob'));

  const hasListConstraint = listFields.some((f) => Array.isArray(config[f]) && config[f].length > 0);
  const hasGlobConstraint = globFields.some((f) => typeof config[f] === 'string' && config[f].length > 0);

  // No allowlist configured: permit everything.
  if (!hasListConstraint && !hasGlobConstraint) {
    return { allowed: true, reason: 'no allowlist configured' };
  }

  // Check explicit list membership.
  for (const field of listFields) {
    if (Array.isArray(config[field]) && config[field].length > 0) {
      if (config[field].includes(target)) {
        return { allowed: true, reason: `matched ${field}` };
      }
    }
  }

  // Check glob patterns.
  for (const field of globFields) {
    if (typeof config[field] === 'string' && config[field].length > 0) {
      if (globMatch(config[field], target)) {
        return { allowed: true, reason: `matched ${field} pattern '${config[field]}'` };
      }
    }
  }

  return {
    allowed: false,
    reason: `'${target}' is not in the configured allowlist for ${providerName}`,
  };
}

export const CAPABILITIES = Object.freeze([
  'read',
  'search',
  'watch',
  'write',
  'webhook',
]);

const REQUIRED_META = ['id', 'displayName', 'capabilities'];
const REQUIRED_METHODS = ['health'];
const CAPABILITY_TO_METHOD = {
  read: 'read',
  search: 'search',
  watch: 'watch',
  write: 'write',
  webhook: 'webhook',
};

export function assertProviderContract(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('provider: must be a non-null object returned from create()');
  }
  if (!provider.meta || typeof provider.meta !== 'object') {
    throw new Error('provider: missing required `meta` object');
  }
  for (const field of REQUIRED_META) {
    if (provider.meta[field] === undefined || provider.meta[field] === null || provider.meta[field] === '') {
      throw new Error(`provider: meta.${field} is required`);
    }
  }
  if (!Array.isArray(provider.meta.capabilities) || provider.meta.capabilities.length === 0) {
    throw new Error(`provider (${provider.meta.id}): meta.capabilities must be a non-empty array`);
  }
  for (const cap of provider.meta.capabilities) {
    if (!CAPABILITIES.includes(cap)) {
      throw new Error(`provider (${provider.meta.id}): unknown capability '${cap}'. Allowed: ${CAPABILITIES.join(', ')}`);
    }
    const method = CAPABILITY_TO_METHOD[cap];
    if (typeof provider[method] !== 'function') {
      throw new Error(`provider (${provider.meta.id}): capability '${cap}' declared but method '${method}' is missing`);
    }
  }
  for (const fn of REQUIRED_METHODS) {
    if (typeof provider[fn] !== 'function') {
      throw new Error(`provider (${provider.meta.id}): missing required method '${fn}'`);
    }
  }
}

export function checkProviderContract(provider) {
  try {
    assertProviderContract(provider);
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
}
