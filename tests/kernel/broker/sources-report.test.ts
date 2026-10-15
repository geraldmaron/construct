/**
 * tests/kernel/broker/sources-report.test.ts — what a session reports it
 * read is kept with each item's address, without credentials, and with a
 * plain note when its text was cut; an address Construct cannot keep comes
 * back as a tool error naming the item, and a step's excerpts are kept
 * without credentials too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { mcpTool, record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
import { REPORTED_TEXT_CAP } from '../../../src/kernel/source/service.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { researchCoverage } from '../../../src/kernel/source/research.ts';
import { brokerFixture, type BrokerFixture } from './support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: BrokerFixture, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, any>;
}

async function refusal(run: () => Promise<unknown>): Promise<ToolInputError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ToolInputError, String(error));
    return error;
  }
  assert.fail('expected a ToolInputError');
}

const BODY = 'a1B2c3D4e5F6g7H8i9J0';
const SECRET = `ghp_${BODY}${BODY.slice(0, 4)}`;

test('a reported item keeps the address a person would open, and an address Construct cannot keep names its item', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'wiki', kind: 'docs', locator: 'confluence:space:ENG' });
    const url = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/98765/Architecture';
    const r = await call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: '98765', url: ` ${url} `, title: 'Architecture', text: 'The gateway fronts every service.' }] });
    assert.equal(r.outcome, 'changed');
    assert.equal(currentManifest(fx.broker.store, 'wiki')!.find((e) => e.ref === '98765')?.url, url);

    for (const [bad, said] of [['wiki/pages/98765', /items\[1\]\.url is not an http\(s\) address/], ['ftp://files.example/a', /not an http\(s\) address/], ['https://me:hunter2@wiki.example/p', /items\[1\]\.url carries credentials/], [`https://wiki.example/p?token=${SECRET}`, /carries credentials/], [42, /not an http\(s\) address/]] as const) {
      const e = await refusal(() => call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'ok', text: 'fine' }, { ref: 'bad', url: bad }] }));
      assert.match(e.message, said);
      assert.equal(e.field, 'items[1].url');
      assert.match(String(e.example), /^https:\/\//);
    }
    assert.equal(currentManifest(fx.broker.store, 'wiki')!.some((e) => e.ref === 'bad' || e.ref === 'ok'), false, 'a refused report records nothing');
  } finally {
    fx.cleanup();
  }
});

test('a report says which items it cut, and keeps their text without credentials', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'wiki', kind: 'docs', locator: 'confluence:space:ENG' });
    const long = `Use ${SECRET} to deploy. ${'more text '.repeat(REPORTED_TEXT_CAP / 8)}`;
    const r = await call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'runbook', text: long }, { ref: 'short', text: 'Short.' }] });
    assert.deepEqual(r.truncated, ['runbook']);
    assert.match(r.next, /at most 256 KiB of UTF-8 per item/);
    assert.match(r.next, /same stable ref and URL/);
    const kept = currentManifest(fx.broker.store, 'wiki')!.find((e) => e.ref === 'runbook')!;
    assert.equal(kept.truncated, true);
    assert.ok(kept.text!.startsWith('Use [redacted] to deploy.'));
    const plain = await call(fx, 'sources', { action: 'report', id: 'wiki', partial: true, items: [{ ref: 'short', text: 'Short, edited.' }] });
    assert.equal(plain.truncated, undefined);
    assert.equal(plain.next, undefined, 'nothing to say when nothing was cut');
  } finally {
    fx.cleanup();
  }
});

test('partial capture recovery keeps stable canonical identity and requires accounting for the remainder', async () => {
  const fx = brokerFixture();
  try {
    const url = 'https://wiki.example/policy';
    await call(fx, 'sources', { action: 'declare', id: 'wiki', kind: 'docs' });
    const long = 'ordinary prose '.repeat(REPORTED_TEXT_CAP / 10) + 'The exact tail.';
    await call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'policy', url, text: long }] });
    const recovered = await call(fx, 'sources', { action: 'report', id: 'wiki', partial: true, items: [{ ref: 'policy', url, text: 'The exact tail.', truncated: true }] });
    assert.deepEqual(recovered.truncated, ['policy']);
    assert.match(recovered.next, /same.*ref|stable.*ref/i);
    assert.match(recovered.next, /referenceDispositions/);
    assert.equal(currentManifest(fx.broker.store, 'wiki')!.length, 1);
    assert.equal((await call(fx, 'check_answer', { answer: 'The exact tail.', citations: [{ ref: url, excerpt: 'The exact tail.' }] })).ok, true);
    const resolve = projectResolver(fx.broker.store, fx.broker.root);
    assert.match(researchCoverage([{ ref: url }], resolve, {}).problems.join(' '), /truncated/);
    assert.deepEqual(researchCoverage([{ ref: url }], resolve, { referenceDispositions: [{ ref: url, status: 'deferred', why: 'The uncaptured remainder remains unreviewed; this answer covers this exact passage only.' }] }).problems, []);
    await assert.rejects(call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'bad', text: 'Observed.', truncated: 'true' }] }), (e: unknown) => e instanceof ToolInputError && e.field === 'items[0].truncated');
  } finally { fx.cleanup(); }
});

test('an excerpt a step hands back is kept without credentials', () => {
  const t = tool('submit_work');
  const input = t.validate(record({ stepRunId: 'step-1', token: 'tok', output: {}, evidence: [{ ref: 'docs/design.md', excerpt: `deploy with ${SECRET} today` }, { ref: 'docs/design.md' }] })) as { evidence: { ref: string; excerpt?: string }[] };
  assert.equal(input.evidence[0]!.excerpt, 'deploy with [redacted] today');
  assert.equal(input.evidence[1]!.excerpt, undefined);
});

test('the public report schema describes a first read without an error-driven discovery round trip', async () => {
  const fx = brokerFixture();
  try {
    const schema = mcpTool(tool('sources')).inputSchema as any;
    const observationSchema = schema.properties.observation;
    assert.deepEqual(new Set(observationSchema.required), new Set(['principal', 'scope', 'operation', 'mode', 'transport', 'expiresAt']));
    assert.deepEqual(observationSchema.properties.transport.enum, ['api', 'mcp', 'local']);
    assert.deepEqual(schema.properties.items.items.required, ['ref']);
    assert.ok(schema.properties.items.items.properties.text);
    await call(fx, 'sources', { action: 'declare', id: 'stock', kind: 'other' });
    const observation = { principal: 'fixture-reader', scope: 'stock', operation: 'read_stock', mode: 'read', transport: 'mcp', expiresAt: '2026-09-02T13:00:00Z' };
    const report = await call(fx, 'sources', { action: 'report', id: 'stock', observation, items: [{ ref: 'counts', text: 'Stock is 40 each.' }] });
    assert.equal(report.outcome, 'changed');
    const check = await call(fx, 'sources', { action: 'check', id: 'stock', request: { principal: observation.principal, scope: observation.scope, operation: observation.operation, mode: observation.mode } });
    assert.equal(check.ready, false, 'a producer report does not establish witnessed access');
    assert.equal(check.grantsPermission, false);
    assert.ok(check.problems.some((p: string) => p.includes('host-reported')));
  } finally { fx.cleanup(); }
});

test('invalid access reports identify nested fields and leave source state unchanged', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'stock', kind: 'other' });
    const observation: Record<string, unknown> = { principal: 'fixture-reader', scope: 'stock', operation: 'read_stock', mode: 'read', transport: 'mcp', expiresAt: '2026-09-02T13:00:00Z' };
    const before = fx.broker.store.db.prepare('SELECT count(*) AS n FROM observations').get()!.n;
    for (const [field, value] of [['expiresAt', undefined], ['expiresAt', 'tomorrow'], ['principal', ''], ['scope', 42], ['operation', null], ['mode', 'write'], ['transport', 'magic'], ['inputSchema', []], ['outputSchema', null]] as const) {
      const error = await refusal(() => call(fx, 'sources', { action: 'report', id: 'stock', observation: { ...observation, [field]: value }, items: [{ ref: 'counts', text: 'Stock is 40 each.' }] }));
      assert.equal(error.field, `observation.${field}`);
    }
    const error = await refusal(() => call(fx, 'sources', { action: 'check', id: 'stock', request: { scope: 'stock', operation: 'read_stock', mode: 'read' } }));
    assert.equal(error.field, 'request.principal');
    const missingRef = await refusal(() => call(fx, 'sources', { action: 'report', id: 'stock', items: [{ text: 'Stock is 40 each.' }] }));
    assert.equal(missingRef.field, 'items[0].ref');
    assert.equal(fx.broker.store.db.prepare('SELECT count(*) AS n FROM observations').get()!.n, before);
    assert.equal(currentManifest(fx.broker.store, 'stock'), null);
  } finally { fx.cleanup(); }
});
