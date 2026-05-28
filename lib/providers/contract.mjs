/**
 * lib/providers/contract.mjs — data-source provider contract.
 *
 * A provider integrates Construct with an external system that holds work
 * artefacts: GitHub repos, Jira projects, Confluence spaces, Slack channels,
 * Salesforce orgs, etc. Providers are stateless adapters — durable state
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
 * they don't implement. The check is deliberately loose — providers can
 * extend the shape with extra methods — but it gates the load-bearing
 * fields so a typo in a plugin can't take down the registry.
 */

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
