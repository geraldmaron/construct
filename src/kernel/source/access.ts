/** Access evidence is scoped observation, never a permission grant. */
import type { StateStore } from '../state/open.ts';
import { getSource } from '../state/sources.ts';
import { redact } from '../render/redact.ts';

export interface AccessDescriptor {
  readonly transport: 'api' | 'mcp' | 'local';
  readonly operation: string;
  readonly mode: 'read' | 'write';
  readonly principal: string;
  readonly scope: string;
  readonly expiresAt: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}
export interface AccessRequest {
  readonly principal: string;
  readonly scope: string;
  readonly operation: string;
  readonly mode: 'read' | 'write';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
export function accessRequest(value: unknown): AccessRequest {
  if (!object(value) || !text(value.principal) || !text(value.scope) || !text(value.operation) || !['read', 'write'].includes(String(value.mode))) throw new Error('access request needs principal, exact scope, operation and mode (read or write)');
  return { principal: value.principal, scope: value.scope, operation: value.operation, mode: value.mode as 'read' | 'write' };
}
export function accessDescriptor(value: unknown): AccessDescriptor {
  const request = accessRequest(value);
  const v = value as Record<string, unknown>;
  if (!['api', 'mcp', 'local'].includes(String(v.transport)) || !text(v.expiresAt) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v.expiresAt) || !Number.isFinite(Date.parse(v.expiresAt))) throw new Error('observation needs transport api/mcp/local and an explicit expiry instant');
  if (JSON.stringify(v).length > 32 * 1024) throw new Error('access observation exceeds 32 KiB');
  for (const k of ['inputSchema', 'outputSchema']) if (v[k] !== undefined && !object(v[k])) throw new Error(`${k} must be an object when observed`);
  // Source/model-supplied session, provenance and grants are deliberately not copied.
  return JSON.parse(redact(JSON.stringify({ ...request, transport: v.transport, expiresAt: v.expiresAt, ...(v.inputSchema ? { inputSchema: v.inputSchema } : {}), ...(v.outputSchema ? { outputSchema: v.outputSchema } : {}) }))) as AccessDescriptor;
}
export function assessAccess(store: StateStore, sourceId: string, request: AccessRequest, sessionId: string | null, at: string) {
  const source = getSource(store, sourceId);
  const problems: string[] = [];
  if (!source || source.status !== 'active') problems.push('source is missing or retired');
  else if (request.mode === 'read' ? !source.canRead : !source.canWrite) problems.push(`${request.mode} permission is disabled by project configuration`);
  const rows = store.db.prepare("SELECT id, evidence_json, observed_at FROM observations WHERE source_id = ? AND kind = 'source.access' ORDER BY rowid DESC").iterate(sourceId) as Iterable<{id: string; evidence_json: string; observed_at: string}>;
  let selected: { id: string; evidence: Record<string, unknown>; observedAt: string } | null = null;
  // Exact scopes only; '*' is an explicit source-wide observation, not a prefix grant.
  for (const row of rows) {
    const e = JSON.parse(row.evidence_json || '{}') as Record<string, unknown>;
    const sourceFailure = e.applicability === 'source' && e.outcome === 'unreachable' && e.operation === '*' && e.scope === '*';
    const ambiguousScopedResult = e.applicability === 'scope' && e.provenance === 'reported' && e.operation === '*' && e.outcome !== 'read';
    if ((e.scope === request.scope || e.scope === '*') && (e.operation === request.operation || sourceFailure || ambiguousScopedResult) && e.mode === request.mode) { selected = { id: row.id, evidence: e, observedAt: row.observed_at }; break; }
  }
  const e = selected?.evidence;
  if (!e) problems.push('no observation for the requested operation and scope; perform a harmless scoped probe');
  else {
    if (e.principal !== request.principal) problems.push('principal changed; access must be observed again for this principal');
    if (!sessionId || e.sessionId !== sessionId) problems.push('access was observed in another session; probe in this session');
    if (typeof e.expiresAt !== 'string' || Date.parse(e.expiresAt) <= Date.parse(at) || !Number.isFinite(Date.parse(e.expiresAt))) problems.push('access observation is expired or has no expiry');
    if (Date.parse(selected!.observedAt) > Date.parse(at)) problems.push('access observation is from the future');
    if (!['read', 'no_results'].includes(String(e.outcome))) problems.push(`observed access outcome is ${String(e.outcome)}; ${String(e.reason ?? 'probe again')}`);
    if (e.provenance !== 'witnessed') problems.push('access is host-reported; no adapter execution witness establishes it');
  }
  return { formatVersion: 1, sourceId, request, ready: problems.length === 0, grantsPermission: false, problems, observation: selected, schemaKnown: object(e?.outputSchema), recovery: problems.length ? 'Use the existing authorized adapter to probe this operation under the current principal/session and record its scope, schema, coverage and expiry. Discovery never grants access.' : null };
}
