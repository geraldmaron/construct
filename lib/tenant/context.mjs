/**
 * lib/tenant/context.mjs — tenant context resolution for the control plane.
 *
 * ADR-0057 (A7) IMPLEMENT-NOW: tenantId is data plumbing, not isolation.
 * resolveTenantContext() is the single place a tenant id is derived from
 * config + env and validated, so run/task/queue/audit records all carry the
 * same value rather than each call site re-deriving it ad hoc. Solo and team
 * modes default to the explicit tenant id 'local'. Enterprise mode has no
 * default: a missing/blank tenant id is a fail-closed TenantResolutionError.
 * No tenant isolation (worker/storage separation) is implied or attempted
 * here — see LMCP-H4.
 */

export const TENANT_ID_ENV_KEY = 'CONSTRUCT_TENANT_ID';
export const DEFAULT_TENANT_ID = 'local';

// A resolvable tenant id is a non-empty, trimmed string. Enterprise mode
// treats anything else (missing, blank, whitespace-only) as unresolved.

function normalizeTenantId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export class TenantResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantResolutionError';
  }
}

/**
 * Resolve the tenant context once, from config + env, validated against the
 * deployment mode. Returns `{ tenantId, source, mode }`.
 *
 * - solo/team: an explicit id from env/config wins; otherwise defaults to
 *   'local' (source: 'default'). Never throws.
 * - enterprise: an explicit id from env/config is required. A missing or
 *   blank id throws TenantResolutionError — enterprise mode fails closed at
 *   startup rather than silently running unlabeled multi-tenant traffic.
 *
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env]
 * @param {object} [opts.config]   loaded project config (reads deployment.tenantId)
 * @param {string} [opts.mode]     deployment mode; if omitted, callers must pass it
 *   explicitly — this module does not import deployment-mode.mjs to avoid a
 *   config-loading cycle (deployment-mode.mjs itself loads project config).
 * @returns {{tenantId: string, source: 'env'|'config'|'default', mode: string}}
 */
export function resolveTenantContext({ env = process.env, config = null, mode = 'solo' } = {}) {
  const fromEnv = normalizeTenantId(env?.[TENANT_ID_ENV_KEY]);
  const fromConfig = !fromEnv ? normalizeTenantId(config?.deployment?.tenantId) : null;
  const resolved = fromEnv || fromConfig;

  if (resolved) {
    return { tenantId: resolved, source: fromEnv ? 'env' : 'config', mode };
  }

  if (mode === 'enterprise') {
    throw new TenantResolutionError(
      `enterprise mode requires a resolvable tenant id; set ${TENANT_ID_ENV_KEY} or deployment.tenantId in construct.config.json. ` +
      'Enterprise mode cannot start without a tenant — see ADR-0057 (A7).',
    );
  }

  return { tenantId: DEFAULT_TENANT_ID, source: 'default', mode };
}

/**
 * Fail-closed startup guard: call once at process/runtime start for enterprise
 * mode. Re-throws TenantResolutionError with the same actionable message;
 * solo/team never throw here since resolveTenantContext always resolves for
 * them. Exposed separately so startup call sites can guard without needing
 * the resolved value.
 *
 * @param {object} [opts]  same shape as resolveTenantContext
 * @returns {{tenantId: string, source: string, mode: string}}
 */
export function requireTenantContext(opts = {}) {
  return resolveTenantContext(opts);
}
