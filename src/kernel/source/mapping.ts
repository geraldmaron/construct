/** Explicit typed mappings preserve source identity and reject ambiguous computation. */
import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import type { RefResolver } from '../project/evidence.ts';
import { latestObservationWith, recordObservation } from '../state/drift.ts';
import { currentManifestRecord, type ManifestEntry } from './manifest.ts';
import { redact } from '../render/redact.ts';

export interface DataMapping {
  readonly item: string;
  readonly records: string;
  readonly identity: string;
  readonly fields: readonly { readonly name: string; readonly path: string; readonly type: 'string' | 'number' | 'boolean'; readonly nullable?: boolean; readonly unit?: string; readonly timezone?: string }[];
  readonly evidence: readonly string[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pointer = (v: unknown): v is string => typeof v === 'string' && v.length <= 512 && (v === '' || (v.startsWith('/') && !/~(?:[^01]|$)/.test(v)));
export function atPointer(value: unknown, path: string): unknown {
  if (!pointer(path)) return undefined;
  if (!path) return value;
  for (const token of path.slice(1).split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, token)) return undefined;
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}
export function dataMapping(value: unknown): DataMapping {
  if (!object(value) || typeof value.item !== 'string' || !value.item.trim() || value.item.length > 512 || !pointer(value.records) || !pointer(value.identity) || !value.identity) throw new Error('mapping needs item, records JSON pointer and nonempty identity JSON pointer');
  if (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 50) throw new Error('mapping needs 1–50 typed fields');
  const names = new Set<string>();
  for (const f of value.fields) {
    if (!object(f) || typeof f.name !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(f.name) || names.has(f.name) || !pointer(f.path) || !['string', 'number', 'boolean'].includes(String(f.type))) throw new Error('mapping fields need unique names, JSON pointers and scalar types');
    names.add(f.name);
    if (f.type === 'number' && f.unit === undefined) throw new Error('numeric mapping fields need observed units (use 1 for explicitly dimensionless values)');
    if (f.nullable !== undefined && typeof f.nullable !== 'boolean') throw new Error('nullable must be boolean');
    for (const k of ['unit', 'timezone']) if (f[k] !== undefined && (typeof f[k] !== 'string' || !(f[k] as string).trim() || (f[k] as string).length > 100)) throw new Error(`${k} must name the observed metadata explicitly`);
  }
  if (!Array.isArray(value.evidence) || !value.evidence.length || value.evidence.length > 20 || value.evidence.some((e) => typeof e !== 'string' || !e.trim())) throw new Error('mapping needs bounded evidence references for its interpretation');
  return JSON.parse(redact(JSON.stringify({ item: value.item, records: value.records, identity: value.identity, fields: value.fields.map((f) => ({ name: f.name, path: f.path, type: f.type, ...(f.nullable !== undefined ? { nullable: f.nullable } : {}), ...(f.unit !== undefined ? { unit: f.unit } : {}), ...(f.timezone !== undefined ? { timezone: f.timezone } : {}) })), evidence: value.evidence }))) as DataMapping;
}
function schemaField(schema: unknown, pointer: string): Record<string, unknown> | null {
  for (const token of pointer.slice(1).split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!object(schema) || !object(schema.properties)) return null;
    schema = Object.hasOwn(schema.properties, token) ? schema.properties[token] : undefined;
  }
  return object(schema) ? schema : null;
}
export function profileItem(entry: ManifestEntry | undefined) {
  if (!entry) return { format: 'unknown', reason: 'item has not been read' };
  if (entry.truncated || entry.weak) return { format: 'unknown', reason: 'item is truncated or was only seen in passing' };
  let value: unknown;
  try { value = JSON.parse(entry.text ?? ''); } catch { return { format: 'unstructured', schema: entry.schema ?? null, reason: 'no complete JSON value; do not infer a typed mapping' }; }
  const describe = (v: unknown): unknown => Array.isArray(v) ? { type: 'array', count: v.length, sample: v.slice(0, 3).map((row) => object(row) ? Object.fromEntries(Object.entries(row).map(([k, n]) => [k, n === null ? 'null' : Array.isArray(n) ? 'array' : typeof n])) : typeof row) } : object(v) ? Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, n]) => [k, Array.isArray(n) ? { type: 'array', count: n.length } : n === null ? 'null' : typeof n])) : typeof v;
  return { format: 'json', shape: describe(value), schema: entry.schema ?? null, fingerprint: entry.fingerprint };
}
export function evaluateMapping(store: StateStore, sourceId: string, mapping: DataMapping, resolve: RefResolver) {
  const manifest = currentManifestRecord(store, sourceId);
  const entry = manifest?.entries.find((e) => e.ref === mapping.item);
  const problems: string[] = [];
  if (!entry || entry.truncated || entry.weak) problems.push('mapping requires a complete, strongly read item');
  const evidence = mapping.evidence.map((ref) => { const hit = resolve(ref); if (!hit || typeof hit.text !== 'string') problems.push(`mapping evidence cannot be read: ${ref}`); return { ref, digest: typeof hit?.text === 'string' ? createHash('sha256').update(hit.text).digest('hex') : null, provenance: hit?.provenance ?? 'unresolved' }; });
  let value: unknown;
  try { value = JSON.parse(entry?.text ?? ''); } catch { problems.push('mapped item is not complete JSON'); }
  const rows = atPointer(value, mapping.records);
  if (!Array.isArray(rows)) problems.push('records pointer no longer addresses an array');
  if (Array.isArray(rows) && rows.length > 200) problems.push('mapping exceeds 200 records; use bounded pages and preserve their coverage before aggregation');
  let schema: unknown = entry?.schema;
  if (mapping.records) schema = schemaField(schema, mapping.records)?.items;
  else if (object(schema)) schema = schema.items;
  for (const field of mapping.fields) {
    const metadata = schemaField(schema, field.path);
    for (const key of ['unit', 'timezone'] as const) if (field[key] !== undefined && metadata?.[key] !== field[key]) problems.push(`${field.name}: ${key} is unknown or changed; expected ${field[key]}, observed ${String(metadata?.[key] ?? 'unknown')}`);
  }
  const ids = new Set<string>();
  const mapped = (Array.isArray(rows) ? rows.slice(0, 200) : []).map((row, index) => {
    const id = atPointer(row, mapping.identity);
    if ((typeof id !== 'string' && typeof id !== 'number') || id === '' || (typeof id === 'number' && !Number.isFinite(id))) problems.push(`row ${String(index)}: required identity is missing, null or invalid`);
    const key = JSON.stringify([typeof id, id]);
    if (ids.has(key)) problems.push(`row ${String(index)}: identity collision within this source item`);
    ids.add(key);
    const values = Object.create(null) as Record<string, unknown>;
    for (const field of mapping.fields) {
      const v = atPointer(row, field.path);
      if (!(v === null && field.nullable) && (typeof v !== field.type || (field.type === 'number' && !Number.isFinite(v)))) problems.push(`row ${String(index)}, ${field.name}: required ${field.type} value is missing, null or incompatible`);
      values[field.name] = v ?? null;
    }
    return { identity: JSON.stringify([sourceId, mapping.item, typeof id, id]), values };
  });
  const snap = latestObservationWith(store, sourceId, 'source.access', 'outcome');
  const coverage = (snap?.evidence as { coverage?: Record<string, unknown>; partial?: boolean } | null)?.coverage;
  const access = snap?.evidence as { outcome?: string; refreshedRefs?: string[]; partial?: boolean } | null;
  const complete = coverage?.complete === true && access?.outcome === 'read' && access.refreshedRefs?.includes(mapping.item) === true && access.partial !== true;
  return { formatVersion: 1, sourceId, item: mapping.item, status: problems.length ? 'blocked' : 'mapped', calculationReady: problems.length === 0, aggregationReady: problems.length === 0 && complete, coverage: coverage ?? null, completeness: complete ? 'complete' : 'partial_or_unknown', provenance: manifest?.provenance ?? 'unresolved', fingerprint: entry?.fingerprint ?? null, mapping, evidence, problems, rows: problems.length ? [] : mapped, next: problems.length ? 'Obtain evidence for an explicit revised mapping before affected calculations.' : complete ? null : 'Row calculations are mapped; source-wide totals require complete coverage. No conversion or cross-source identity equivalence was inferred.' };
}
export function sourceMapping(store: StateStore, input: { sourceId: string; item: string; mapping?: DataMapping; resolve: RefResolver; at: string; nextId: () => string }) {
  const previous = store.db.prepare("SELECT evidence_json FROM observations WHERE source_id = ? AND kind = 'source.mapping' AND json_extract(evidence_json, '$.mapping.item') = ? ORDER BY rowid DESC LIMIT 1").get(input.sourceId, input.item) as { evidence_json: string } | undefined;
  const mapping = input.mapping ?? (previous ? (JSON.parse(previous.evidence_json) as { mapping: DataMapping }).mapping : undefined);
  if (!mapping) return { status: 'unmapped', calculationReady: false, profile: profileItem(currentManifestRecord(store, input.sourceId)?.entries.find((e) => e.ref === input.item)), next: 'Provide an evidence-backed mapping of records, identity and typed fields; declare observed units/timezones when calculations depend on them.' };
  const result = evaluateMapping(store, input.sourceId, mapping, input.resolve);
  if (!input.mapping && previous) {
    const recorded = JSON.parse(previous.evidence_json) as { evidence: { ref: string; digest: string | null }[] };
    if (recorded.evidence.some((e) => e.digest === null || !result.evidence.some((current) => current.ref === e.ref && current.digest === e.digest))) {
      result.problems.push('mapping interpretation evidence changed; review and record a new mapping');
      result.status = 'blocked'; result.calculationReady = false; result.aggregationReady = false; result.rows = [];
    }
  }
  if (input.mapping) recordObservation(store, { id: input.nextId(), sourceId: input.sourceId, kind: 'source.mapping', summary: `${input.item}: ${result.status}`, evidence: { mapping, evidence: result.evidence, fingerprint: result.fingerprint, provenance: 'reported' }, at: input.at });
  return result;
}
