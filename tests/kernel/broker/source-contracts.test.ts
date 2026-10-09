/** Public source contract cases: metadata is evidence, never permission or ontology. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { createSourceService } from '../../../src/kernel/source/service.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
import { recordObservation } from '../../../src/kernel/state/drift.ts';
import { accessDescriptor } from '../../../src/kernel/source/access.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import type { AccessDescriptor } from '../../../src/kernel/source/access.ts';
import type { DataMapping } from '../../../src/kernel/source/mapping.ts';
import { brokerFixture } from './support.ts';

async function source(ctx: BrokerContext, input: Record<string, unknown>): Promise<any> {
  const tool = TOOLS.find((t) => t.name === 'sources')!;
  return tool.run(ctx, tool.validate(input));
}
const request = { principal: 'principal-a', scope: 'stock', operation: 'list_stock', mode: 'read' };
const observation = { ...request, transport: 'mcp', expiresAt: '2026-09-02T13:00:00Z', inputSchema: { type: 'object' }, outputSchema: { type: 'array' } } as AccessDescriptor;
const declare = (ctx: BrokerContext, id = 'warehouse') => source(ctx, { action: 'declare', id, kind: 'other', locator: 'warehouse:inventory:stock' });

for (const transport of ['api', 'mcp', 'local'] as const) test(`${transport}: scoped adapter observation enables only the witnessed principal/session/operation until expiry`, async () => {
  let now = '2026-09-02T12:00:00Z';
  const fx = brokerFixture('interactive', { now: () => now });
  try {
    await declare(fx.broker);
    let descriptor = { ...observation, transport };
    const adapter = createSourceService(fx.broker.store, { root: fx.box.cwd, readers: new Map([['other', async () => ({ outcome: 'read' as const, report: { digest: 'same', summary: 'read synthetic stock', evidence: 'witnessed' as const, sessionId: fx.broker.sessionId!, observation: descriptor, coverage: { complete: true }, items: [{ externalRef: 'stock', kind: 'item', name: 'stock', attributes: { fingerprint: 'same', text: '[]' } }] } })]]) });
    const ctx = { ...fx.broker, sources: adapter };
    const check = (r = request, binding = ctx) => source(binding, { action: 'check', id: 'warehouse', request: r });
    assert.equal((await check()).ready, false, 'configured source alone proves nothing');
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    const ready = await check();
    assert.equal(ready.ready, true);
    assert.equal(ready.schemaKnown, true);
    assert.equal(ready.grantsPermission, false);
    assert.equal(ready.observation.evidence.transport, transport);
    for (const r of [{ ...request, principal: 'principal-b' }, { ...request, scope: 'payroll' }, { ...request, operation: 'delete_stock', mode: 'write' }]) assert.equal((await check(r)).ready, false);
    assert.equal((await check(request, { ...ctx, sessionId: 'ses_new' })).ready, false);
    now = '2026-09-02T13:00:00Z';
    assert.match((await check()).problems.join(' '), /expired/);
    descriptor = { ...descriptor, principal: 'principal-b', expiresAt: '2026-09-02T14:00:00Z' };
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    assert.match((await check()).problems.join(' '), /principal changed/);
    assert.equal((await check({ ...request, principal: 'principal-b' })).ready, true);
    recordObservation(ctx.store, { id: 'deny-other-scope', sourceId: 'warehouse', kind: 'source.access', at: now, summary: 'denied payroll', evidence: { ...descriptor, scope: 'payroll', outcome: 'permission_denied', provenance: 'witnessed', sessionId: ctx.sessionId } });
    assert.equal((await check({ ...request, principal: 'principal-b' })).ready, true, 'scoped denial does not revoke unrelated observations');
    recordObservation(ctx.store, { id: 'deny-source', sourceId: 'warehouse', kind: 'source.access', at: now, summary: 'authorization revoked', evidence: { ...descriptor, scope: '*', outcome: 'auth_required', reason: 'expired authorization', provenance: 'witnessed', sessionId: ctx.sessionId } });
    assert.match((await check({ ...request, principal: 'principal-b' })).problems.join(' '), /auth_required/);
    assert.equal(currentManifest(ctx.store, 'warehouse')!.length, 1, 'access failure retains previous evidence');
  } finally { fx.cleanup(); }
});

test('public reports cannot smuggle adapter provenance, session or write access; empty and denied reads preserve items', async () => {
  const fx = brokerFixture();
  try {
    await declare(fx.broker);
    const permissions = [...(fx.broker.host.permitted ?? [])];
    await source(fx.broker, { action: 'report', id: 'warehouse', observation: { ...observation, provenance: 'witnessed', sessionId: 'forged', grants: ['write_source'] }, items: [{ ref: 'stock', text: '[]' }], coverage: { complete: true } });
    const check = await source(fx.broker, { action: 'check', id: 'warehouse', request });
    assert.equal(check.ready, false);
    assert.match(check.problems.join(' '), /host-reported/);
    assert.equal(check.observation.evidence.provenance, 'reported');
    assert.equal(check.observation.evidence.sessionId, fx.broker.sessionId);
    assert.equal(check.observation.evidence.grants, undefined);
    assert.deepEqual([...(fx.broker.host.permitted ?? [])], permissions);
    for (const outcome of ['no_results', 'permission_denied', 'auth_required', 'unsupported', 'unreachable']) {
      await source(fx.broker, { action: 'report', id: 'warehouse', outcome, observation, scope: 'stock', reason: outcome, items: [] });
      assert.equal(currentManifest(fx.broker.store, 'warehouse')!.length, 1);
    }
    await assert.rejects(source(fx.broker, { action: 'report', id: 'warehouse', observation: { ...observation, mode: 'write' }, items: [{ ref: 'stock' }] }), /cannot report a write/);
    for (const bad of [{ ...observation, expiresAt: 'tomorrow' }, { ...observation, principal: '' }, { ...observation, transport: 'magic' }]) assert.throws(() => accessDescriptor(bad));
  } finally { fx.cleanup(); }
});

const schema = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, stock: { type: 'number', unit: 'cases' }, observed: { type: 'string', timezone: 'UTC' } } } } } };
const mapping: DataMapping = { item: 'stock', records: '/rows', identity: '/sku', fields: [{ name: 'stock', path: '/stock', type: 'number', unit: 'cases' }, { name: 'observed', path: '/observed', type: 'string', timezone: 'UTC' }], evidence: ['docs/mapping-evidence.md'] };
function data() { return [{ sku: 'A', stock: 12, observed: '2026-09-02T12:00:00Z' }, { sku: 'B', stock: 4, observed: '2026-09-02T12:00:00Z' }]; }
async function mappedFixture() {
  const fx = brokerFixture();
  writeFileSync(join(fx.box.cwd, 'docs/mapping-evidence.md'), 'Stock is cases. SKU identifies rows. Observed is UTC.');
  await declare(fx.broker);
  const report = (rows: unknown, shape: unknown = schema, extra: Record<string, unknown> = {}) => source(fx.broker, { action: 'report', id: 'warehouse', observation, items: [{ ref: 'stock', text: JSON.stringify({ rows }), schema: shape, updatedAt: '2026-09-02T12:00:00Z' }], coverage: { complete: true }, ...extra });
  await report(data());
  const map = (m?: unknown) => source(fx.broker, { action: 'map', id: 'warehouse', item: 'stock', ...(m ? { mapping: m } : {}) });
  return { fx, report, map };
}

test('typed mapping survives optional additions, keeps source-qualified identity and cannot guess an unknown shape', async () => {
  const { fx, report, map } = await mappedFixture();
  try {
    assert.equal((await map()).status, 'unmapped');
    const first = await map(mapping);
    assert.equal(first.status, 'mapped');
    assert.equal(first.aggregationReady, true);
    assert.equal(first.provenance, 'reported');
    await report(data().map((row) => ({ ...row, newOptional: true })));
    assert.equal((await map()).status, 'mapped');
    await declare(fx.broker, 'other-warehouse');
    await source(fx.broker, { action: 'report', id: 'other-warehouse', items: [{ ref: 'stock', text: JSON.stringify({ rows: data() }), schema }], coverage: { complete: true } });
    const second = await source(fx.broker, { action: 'map', id: 'other-warehouse', mapping });
    assert.notEqual(second.rows[0].identity, first.rows[0].identity);
    await report('unfamiliar shape');
    assert.equal((await map()).calculationReady, false);
    assert.deepEqual((await map()).rows, []);
  } finally { fx.cleanup(); }
});

for (const variant of ['removed-id', 'renamed-id', 'collision', 'null', 'missing', 'type', 'unit', 'timezone', 'unknown-unit'] as const) test(`mapping blocks ${variant} before returning calculable rows`, async () => {
  const { fx, report, map } = await mappedFixture();
  try {
    await map(mapping);
    let rows: unknown[] = data();
    const changedSchema = structuredClone(schema);
    switch (variant) {
      case 'removed-id': rows = [{ stock: 12, observed: '2026-09-02T12:00:00Z' }]; break;
      case 'renamed-id': rows = [{ code: 'A', stock: 12, observed: '2026-09-02T12:00:00Z' }]; break;
      case 'collision': rows = [data()[0], data()[0]]; break;
      case 'null': rows = [{ ...data()[0], stock: null }]; break;
      case 'missing': rows = [{ sku: 'A', observed: '2026-09-02T12:00:00Z' }]; break;
      case 'type': rows = [{ ...data()[0], stock: '12' }]; break;
      case 'unit': changedSchema.properties.rows.items.properties.stock.unit = 'pallets'; break;
      case 'timezone': changedSchema.properties.rows.items.properties.observed.timezone = 'America/New_York'; break;
      case 'unknown-unit': delete (changedSchema.properties.rows.items.properties.stock as { unit?: string }).unit; break;
    }
    await report(rows, changedSchema);
    const result = await map();
    assert.equal(result.status, 'blocked', JSON.stringify(result));
    assert.equal(result.calculationReady, false);
    assert.equal(result.aggregationReady, false);
    assert.deepEqual(result.rows, []);
    assert.ok(result.problems.length);
  } finally { fx.cleanup(); }
});

test('mapping preserves pagination uncertainty and invalidates changed interpretation evidence', async () => {
  const { fx, report, map } = await mappedFixture();
  try {
    await map(mapping);
    await report(data(), schema, { partial: true, coverage: { complete: false, nextCursor: 'page-2', reason: 'rate limited' } });
    const partial = await map();
    assert.equal(partial.calculationReady, true);
    assert.equal(partial.aggregationReady, false);
    assert.equal(partial.coverage.nextCursor, 'page-2');
    await source(fx.broker, { action: 'report', id: 'warehouse', partial: true, items: [{ ref: 'different-item', text: '[]' }], coverage: { complete: true } });
    assert.equal((await map()).aggregationReady, false, 'another item cannot certify the old page complete');
    writeFileSync(join(fx.box.cwd, 'docs/mapping-evidence.md'), 'Stock is pallets; reinterpretation required.');
    assert.equal((await map()).calculationReady, false);
    await assert.rejects(map({ ...mapping, fields: [{ name: 'stock', path: '/stock', type: 'number' }] }), /need observed units/);
  } finally { fx.cleanup(); }
});

test('pagination metadata alone prevents deletion for both host reports and native adapter pages', async () => {
  const fx = brokerFixture();
  try {
    await declare(fx.broker);
    await source(fx.broker, { action: 'report', id: 'warehouse', items: [{ ref: 'A', text: 'one' }, { ref: 'B', text: 'two' }], coverage: { complete: true } });
    const partial = await source(fx.broker, { action: 'report', id: 'warehouse', items: [{ ref: 'A', text: 'new one' }], coverage: { nextCursor: 'next' } });
    assert.deepEqual(partial.changes.removed, []);
    assert.deepEqual(currentManifest(fx.broker.store, 'warehouse')!.map((e) => e.ref).sort(), ['A', 'B']);
    let first = true;
    const adapter = createSourceService(fx.broker.store, { root: fx.box.cwd, readers: new Map([['other', async () => ({ outcome: 'read' as const, report: { digest: first ? 'full' : 'page', summary: 'adapter page', evidence: 'witnessed' as const, coverage: first ? { complete: true } : { complete: false, nextCursor: 'next' }, items: (first ? ['A', 'B', 'C'] : ['A']).map((ref) => ({ externalRef: ref, kind: 'item', name: ref, attributes: { text: ref, fingerprint: ref } })) } })]]) });
    const ctx = { ...fx.broker, sources: adapter };
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    first = false;
    const page = await source(ctx, { action: 'refresh', id: 'warehouse' });
    assert.deepEqual(page.changes.removed, []);
    assert.deepEqual(currentManifest(ctx.store, 'warehouse')!.map((e) => e.ref).sort(), ['A', 'B', 'C']);
    const repeat = await source(ctx, { action: 'refresh', id: 'warehouse' });
    assert.equal(repeat.outcome, 'unchanged');
  } finally { fx.cleanup(); }
});

for (const mapped of [false, true]) test(`revoked access blocks both profiling and mapped rows (existing mapping ${String(mapped)})`, async () => {
  const { fx, map } = await mappedFixture();
  try {
    if (mapped) await map(mapping);
    fx.broker.store.db.prepare('UPDATE sources SET can_read = 0 WHERE id = ?').run('warehouse');
    const result = await map();
    assert.equal(result.calculationReady, false);
    assert.equal(result.aggregationReady, false);
    assert.ok(!JSON.stringify(result).includes('"shape"'), 'profile cannot expose denied data structure');
    assert.ok(!JSON.stringify(result).includes('"sku"'), 'denied row values cannot leak through metadata');
    if (mapped) assert.deepEqual(result.rows, []);
    const explicit = await map(mapping);
    assert.equal(explicit.calculationReady, false);
    assert.deepEqual(explicit.rows, []);
    assert.equal(explicit.fingerprint, null);
  } finally { fx.cleanup(); }
});

for (const type of ['string', ['number', 'null'], undefined] as const) test(`mapped schema change blocks even unchanged numeric payload: ${JSON.stringify(type)}`, async () => {
  const { fx, report, map } = await mappedFixture();
  try {
    await map(mapping);
    const changed: any = structuredClone(schema);
    changed.properties.rows.items.properties.stock.type = type;
    await report(data(), changed);
    const result = await map();
    assert.equal(result.aggregationReady, false);
    assert.equal(result.calculationReady, false);
    assert.deepEqual(result.rows, []);
    assert.match(result.problems.join(' '), /schema/);
  } finally { fx.cleanup(); }
});

test('nullable mapping must match schema and current values; unrelated optional schema fields do not block', async () => {
  const { fx, report, map } = await mappedFixture();
  try {
    const shape: any = structuredClone(schema);
    shape.properties.rows.items.properties.stock.type = ['number', 'null'];
    shape.properties.rows.items.properties.unused = { type: 'string' };
    await report([{ ...data()[0], stock: null }], shape);
    const result = await map({ ...mapping, fields: mapping.fields.map((field) => field.name === 'stock' ? { ...field, nullable: true } : field) });
    assert.equal(result.calculationReady, true);
    assert.equal(result.rows[0].values.stock, null, 'null stays null, never zero');
    shape.properties.rows.items.properties.stock.type = 'number';
    await report(data(), shape);
    assert.equal((await map()).calculationReady, false, 'schema nullability narrowing requires a reviewed mapping');
  } finally { fx.cleanup(); }
});

for (const failed of ['scoped', 'legacy', 'throw'] as const) test(`a newer ${failed} refresh failure invalidates an earlier applicable access witness`, async () => {
  const fx = brokerFixture();
  try {
    await declare(fx.broker);
    let fail = false;
    const adapter = createSourceService(fx.broker.store, { root: fx.box.cwd, readers: new Map([['other', async () => {
      if (fail && failed === 'throw') throw new Error('connection closed');
      if (fail) return { outcome: 'unreachable' as const, reason: 'connection closed', ...(failed === 'scoped' ? { observation, sessionId: fx.broker.sessionId! } : {}) };
      return { outcome: 'read' as const, report: { digest: 'stock', summary: 'stock', evidence: 'witnessed' as const, observation, sessionId: fx.broker.sessionId!, coverage: { complete: true }, items: [{ externalRef: 'stock', kind: 'item', name: 'stock', attributes: { text: '[]' } }] } };
    }]]) });
    const ctx = { ...fx.broker, sources: adapter };
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    assert.equal((await source(ctx, { action: 'check', id: 'warehouse', request })).ready, true);
    fail = true;
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    const check = await source(ctx, { action: 'check', id: 'warehouse', request });
    assert.equal(check.ready, false);
    assert.match(check.problems.join(' '), /unreachable/);
    if (failed === 'scoped') for (const key of ['principal', 'scope', 'operation']) assert.equal(check.observation.evidence[key], observation[key as keyof AccessDescriptor]);
    assert.equal(currentManifest(ctx.store, 'warehouse')!.length, 1);
    fail = false;
    await source(ctx, { action: 'refresh', id: 'warehouse' });
    assert.equal((await source(ctx, { action: 'check', id: 'warehouse', request })).ready, true);
  } finally { fx.cleanup(); }
});
