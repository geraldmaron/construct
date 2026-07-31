/**
 * lib/tenant/isolation.mjs — cross-tenant read guard for the control plane.
 *
 * lib/tenant/context.mjs (H1) resolves a tenant id; lib/identity.mjs (H2) resolves
 * an actor; I3 landed durable audit/denied records that carry both. None of that
 * enforces a boundary — a record tagged tenant "acme" is still just a JSON line a
 * caller with tenant "other" can read if nothing stops them. Physical per-tenant
 * storage backends are not yet landed (queue/store today are scoped by
 * rootDir, not tenant). Until they are, this module is the enforcement layer that
 * makes the tenant tag load-bearing everywhere it already exists:
 *
 *   - assertTenantMatch(recordTenant, contextTenant) — throws TenantIsolationViolation
 *     (fail-closed) on any mismatch, and on a missing/blank tenant on either side.
 *   - scopeToTenant(records, tenantId) — filters a record list down to exactly the
 *     records whose `tenant`/`tenantId` field matches, fail-closed (throws) if
 *     tenantId itself is unresolved rather than silently returning everything.
 *   - readTenantScoped(readAll, tenantId) — composes a raw "read everything" API
 *     (queue.listPending, DeniedStore.readAll, readAuditTrail, a store's list*) with
 *     scopeToTenant so a caller gets a tenant-safe view over today's rootDir-scoped
 *     backends without waiting on H4's physical isolation.
 *
 * Scope: no physical isolation (no per-tenant encryption, no separate
 * database/schema) — see H4 for that. The narrower, verifiable guarantee: any
 * record path that stamps a tenant field cannot be read across a tenant boundary
 * through these accessors, and is fail-closed (throws) rather than fail-open when
 * the tenant dimension is missing or unresolved on either side.
 */

export class TenantIsolationViolation extends Error {
  constructor(message, { recordTenant, contextTenant } = {}) {
    super(message);
    this.name = 'TenantIsolationViolation';
    this.recordTenant = recordTenant ?? null;
    this.contextTenant = contextTenant ?? null;
  }
}

function normalize(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Fail-closed equality check between a record's tenant and the requesting
 * context's tenant. Throws TenantIsolationViolation on mismatch, and also on
 * either side being missing/blank — an unresolved tenant is never treated as
 * a wildcard that matches everything.
 *
 * @param {string} recordTenant
 * @param {string} contextTenant
 */
export function assertTenantMatch(recordTenant, contextTenant) {
  const rec = normalize(recordTenant);
  const ctx = normalize(contextTenant);

  if (!ctx) {
    throw new TenantIsolationViolation(
      'tenant isolation: requesting context has no resolvable tenant id — refusing read fail-closed',
      { recordTenant: rec, contextTenant: ctx },
    );
  }
  if (!rec) {
    throw new TenantIsolationViolation(
      'tenant isolation: record has no resolvable tenant id — refusing read fail-closed',
      { recordTenant: rec, contextTenant: ctx },
    );
  }
  if (rec !== ctx) {
    throw new TenantIsolationViolation(
      `tenant isolation violation: record tenant "${rec}" is not readable from tenant "${ctx}" context`,
      { recordTenant: rec, contextTenant: ctx },
    );
  }
}

// Records observed across queue/audit/denied-store use either `tenant` (I3
// decision-record schema: audit-trail, denied-store) or `tenantId` (H1 queue
// entries, orchestration run/task records) — checked in that order so one
// helper covers both shapes without callers needing to know which field name
// their backend uses.

function tenantFieldOf(record) {
  if (record && typeof record === 'object') {
    if ('tenant' in record) return record.tenant;
    if ('tenantId' in record) return record.tenantId;
  }
  return null;
}

/**
 * Filter a record list down to exactly the records belonging to tenantId.
 * Fail-closed: throws TenantIsolationViolation if tenantId itself is
 * unresolved (missing/blank) rather than returning the unfiltered list —
 * an isolation filter that no-ops on missing context is not a filter.
 * Records with no resolvable tenant field are dropped, not leaked through.
 *
 * @param {object[]} records
 * @param {string} tenantId
 * @returns {object[]}
 */
export function scopeToTenant(records, tenantId) {
  const ctx = normalize(tenantId);
  if (!ctx) {
    throw new TenantIsolationViolation(
      'tenant isolation: scopeToTenant called with no resolvable tenant id — refusing to read any records',
      { recordTenant: null, contextTenant: null },
    );
  }
  return (records || []).filter((record) => normalize(tenantFieldOf(record)) === ctx);
}

/**
 * Compose a raw "read everything" accessor with scopeToTenant, so a caller
 * gets a tenant-safe view over a backend that has no native tenant filter
 * (today's rootDir-scoped queue/store/audit readers). `readAll` may be sync
 * or return a promise; the tenant filter is applied to whatever it resolves.
 *
 * @param {function(): (object[]|Promise<object[]>)} readAll
 * @param {string} tenantId
 * @returns {object[]|Promise<object[]>}
 */
export function readTenantScoped(readAll, tenantId) {
  const result = readAll();
  if (result && typeof result.then === 'function') {
    return result.then((records) => scopeToTenant(records, tenantId));
  }
  return scopeToTenant(result, tenantId);
}
