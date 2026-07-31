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
 *
 * Provider filter block: `validateFilterConfig(providerName,
 * filter)` validates a `{ scope, predicates, nativeQuery }` block against
 * `SCOPE_FIELDS_BY_PROVIDER` and the normalized predicate keys in
 * `lib/providers/filter-schema.mjs`, throwing on any key the provider kind
 * does not declare — fail closed at poll time, never a silent no-op.
 * `matchesFilter(item, filter, providerName)` re-evaluates `scope` and
 * `predicates` plane-side against a fetched item; this is the mandatory
 * post-fetch backstop even when a provider pushed the same filter down
 * server-side (Jira JQL, etc.). `filterHash(filter)` derives the stable
 * digest recorded in the per-poll audit line.
 */

import crypto from 'node:crypto';

import { PREDICATE_KEYS, SCOPE_KEYS, STATUS_CATEGORIES, TOP_LEVEL_KEYS } from './filter-schema.mjs';

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

// ─── Provider filter block (scope + predicates + nativeQuery) ───────────────

// Which `scope` container keys and passthrough capability each provider kind
// declares. Mirrors the dead *Allowlist fields ALLOWLIST_SCHEMA carried
// per-provider, now under the one normalized `scope` container.

export const SCOPE_FIELDS_BY_PROVIDER = Object.freeze({
  github: { scope: ['repos', 'repoGlob'], nativeQuery: true },
  'atlassian-jira': { scope: ['projects'], nativeQuery: true },
  jira: { scope: ['projects'], nativeQuery: true },
  'atlassian-confluence': { scope: ['spaces'], nativeQuery: false },
  slack: { scope: ['channels'], nativeQuery: false },
  salesforce: { scope: ['projects'], nativeQuery: true },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a filter block against the scope fields and predicate
 * keys the given provider kind declares. Any unknown top-level key, unknown
 * scope key, unknown predicate key, or `nativeQuery` on a provider that
 * doesn't support passthrough throws — fail closed, never a silent no-op.
 * Returns the block unchanged (for chaining) when it is valid.
 */
export function validateFilterConfig(providerName, filter) {
  if (filter == null) return filter;
  if (!isPlainObject(filter)) {
    throw new Error(`provider filter (${providerName}): filter must be an object`);
  }

  for (const key of Object.keys(filter)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      throw new Error(`provider filter (${providerName}): unknown filter key "${key}". Allowed: ${TOP_LEVEL_KEYS.join(', ')}`);
    }
  }

  const allowed = SCOPE_FIELDS_BY_PROVIDER[providerName] ?? { scope: SCOPE_KEYS, nativeQuery: true };

  if (filter.scope !== undefined) {
    if (!isPlainObject(filter.scope)) {
      throw new Error(`provider filter (${providerName}): scope must be an object`);
    }
    for (const key of Object.keys(filter.scope)) {
      if (!SCOPE_KEYS.includes(key)) {
        throw new Error(`provider filter (${providerName}): unknown scope key "${key}". Allowed: ${SCOPE_KEYS.join(', ')}`);
      }
      if (!allowed.scope.includes(key)) {
        throw new Error(`provider filter (${providerName}): scope key "${key}" is not supported by this provider kind. Allowed: ${allowed.scope.join(', ') || '(none)'}`);
      }
      if (!Array.isArray(filter.scope[key])) {
        throw new Error(`provider filter (${providerName}): scope.${key} must be an array`);
      }
    }
  }

  if (filter.predicates !== undefined) {
    if (!isPlainObject(filter.predicates)) {
      throw new Error(`provider filter (${providerName}): predicates must be an object`);
    }
    for (const key of Object.keys(filter.predicates)) {
      if (!PREDICATE_KEYS.includes(key)) {
        throw new Error(`provider filter (${providerName}): unknown predicate key "${key}". Allowed: ${PREDICATE_KEYS.join(', ')}`);
      }
      if (key === 'statusCategory') {
        const values = filter.predicates[key];
        if (!Array.isArray(values) || values.some((v) => !STATUS_CATEGORIES.includes(v))) {
          throw new Error(`provider filter (${providerName}): predicates.statusCategory must be an array drawn from ${STATUS_CATEGORIES.join(', ')}`);
        }
      } else if (key === 'updatedSince') {
        if (typeof filter.predicates[key] !== 'string' || !filter.predicates[key]) {
          throw new Error(`provider filter (${providerName}): predicates.updatedSince must be a non-empty string`);
        }
      } else if (!Array.isArray(filter.predicates[key])) {
        throw new Error(`provider filter (${providerName}): predicates.${key} must be an array`);
      }
    }
  }

  if (filter.nativeQuery !== undefined) {
    if (typeof filter.nativeQuery !== 'string' || !filter.nativeQuery) {
      throw new Error(`provider filter (${providerName}): nativeQuery must be a non-empty string`);
    }
    if (!allowed.nativeQuery) {
      throw new Error(`provider filter (${providerName}): nativeQuery passthrough is not supported by this provider kind`);
    }
  }

  return filter;
}

/**
 * Stable content hash of an effective filter block, recorded in the per-poll
 * audit line so operators can tell whether the enforced filter changed
 * between polls without diffing the full block.
 */
export function filterHash(filter) {
  const normalized = filter == null ? {} : filter;
  return crypto.createHash('sha256').update(JSON.stringify(normalized, Object.keys(normalized).sort())).digest('hex').slice(0, 16);
}

function parseUpdatedSince(value) {
  if (!value) return null;
  const isoDuration = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value);
  if (isoDuration) {
    const days = Number(isoDuration[1] ?? 0);
    const hours = Number(isoDuration[2] ?? 0);
    const minutes = Number(isoDuration[3] ?? 0);
    const ms = ((days * 24 + hours) * 60 + minutes) * 60_000;
    return Date.now() - ms;
  }
  const absolute = Date.parse(value);
  return Number.isNaN(absolute) ? null : absolute;
}

function scopeContainerValue(item, key) {
  if (key === 'projects') return item.project ?? null;
  if (key === 'repos' || key === 'repoGlob') return item.repo ?? null;
  if (key === 'channels') return item.channelId ?? item.channel ?? null;
  if (key === 'spaces') return item.space ?? item.spaceKey ?? null;
  return null;
}

function matchesScope(item, scope) {
  if (!scope) return true;
  for (const key of SCOPE_KEYS) {
    const constraint = scope[key];
    if (!Array.isArray(constraint) || constraint.length === 0) continue;
    const value = scopeContainerValue(item, key);
    if (value == null) return false;
    if (key === 'repoGlob') {
      if (!constraint.some((pattern) => globMatch(pattern, value))) return false;
    } else if (!constraint.includes(value)) {
      return false;
    }
  }
  return true;
}

function matchesPredicates(item, predicates) {
  if (!predicates) return true;

  if (Array.isArray(predicates.assignee) && predicates.assignee.length > 0) {
    if (!predicates.assignee.includes(item.assignee)) return false;
  }
  if (Array.isArray(predicates.statusCategory) && predicates.statusCategory.length > 0) {
    const normalized = normalizeStatusCategory(item.statusCategory ?? item.status);
    if (!predicates.statusCategory.includes(normalized)) return false;
  }
  if (Array.isArray(predicates.priority) && predicates.priority.length > 0) {
    if (!predicates.priority.includes(item.priority)) return false;
  }
  if (Array.isArray(predicates.label) && predicates.label.length > 0) {
    const itemLabels = Array.isArray(item.labels) ? item.labels : [];
    if (!predicates.label.some((l) => itemLabels.includes(l))) return false;
  }
  if (typeof predicates.updatedSince === 'string' && predicates.updatedSince) {
    const threshold = parseUpdatedSince(predicates.updatedSince);
    const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : NaN;
    if (threshold != null && (Number.isNaN(updatedAt) || updatedAt < threshold)) return false;
  }
  return true;
}

/**
 * Normalize a provider-native status string to the statusCategory
 * enum (to-do | in-progress | done) so the same predicate expresses
 * identically across Jira, GitHub, and Salesforce.
 */
export function normalizeStatusCategory(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (/done|closed|resolved|complete/.test(s)) return 'done';
  if (/progress|review|doing|active/.test(s)) return 'in-progress';
  if (/to.?do|open|backlog|new|triage/.test(s)) return 'to-do';
  return null;
}

/**
 * Plane-side re-evaluation of a filter against a fetched item.
 * Mandatory universal fallback: runs even when the provider already pushed
 * the same filter down server-side, and is the sole enforcement point for
 * providers with no server-side filtering. `nativeQuery` has no plane-side
 * equivalent (opaque passthrough) — its effect is assumed already applied
 * by the provider fetch; `scope` and `predicates` are conjoined here.
 */
export function matchesFilter(item, filter) {
  if (filter == null) return true;
  return matchesScope(item, filter.scope) && matchesPredicates(item, filter.predicates);
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
