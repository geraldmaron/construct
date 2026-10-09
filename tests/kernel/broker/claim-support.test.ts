/** Withheld adversarial expectations are independent of the checked answer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { brokerFixture } from './support.ts';

async function call(fx: ReturnType<typeof brokerFixture>, name: string, input: Record<string, unknown>): Promise<any> {
  const t = TOOLS.find((t) => t.name === name)!;
  return t.run(fx.broker, t.validate(input));
}
const cases = [
  { name: 'polarity counterexample', source: 'The service does not store passwords.', answer: 'The service stores passwords.', expected: 'contradicted' },
  { name: 'preserved negation paraphrase', source: 'The service does not store passwords.', answer: 'The service never stores passwords.', expected: 'supported' },
  { name: 'contraction paraphrase', source: 'The service never stores passwords.', answer: "The service doesn't store passwords.", expected: 'supported' },
  { name: 'positive clause', source: 'The service encrypts passwords.', answer: 'The service encrypts passwords.', expected: 'supported' },
  { name: 'misleading quoted substring', source: 'The marketing claim "The service stores passwords" is false.', answer: 'The service stores passwords.', expected: 'unknown' },
  { name: 'conditional quote', source: 'If enabled, the service stores passwords.', answer: 'The service stores passwords.', expected: 'unknown' },
  { name: 'modal claim', source: 'The service may store passwords.', answer: 'The service stores passwords.', expected: 'unknown' },
  { name: 'unfamiliar paraphrase', source: 'Credentials are retained transiently in volatile buffers.', answer: 'Password persistence is disabled.', expected: 'unknown' },
  { name: 'scope mismatch', source: 'The EU service stores passwords.', answer: 'The US service stores passwords.', expected: 'unknown' },
] as const;
for (const c of cases) test(`plain answer claim support: ${c.name}`, async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'docs/evidence.md'), c.source);
    const r = await call(fx, 'check_answer', { answer: c.answer, citations: [{ ref: 'docs/evidence.md' }], claims: [{ claim: c.answer, refs: ['docs/evidence.md'] }] });
    assert.equal(r.claimSupport.results[0].status, c.expected);
    assert.equal(r.ok, c.expected === 'supported');
    assert.equal(r.semanticSupportVerified, false, 'bounded checks do not claim whole-answer semantic truth');
    assert.equal(r.claimSupport.complete, false);
    assert.equal(fx.broker.store.db.prepare('SELECT count(*) AS n FROM workflow_runs').get()!.n, 0, 'Q&A starts no managed work');
    assert.equal(fx.broker.store.db.prepare('SELECT count(*) AS n FROM work_items').get()!.n, 0);
  } finally { fx.cleanup(); }
});

test('ordinary answer without explicit claims still catches the known polarity failure', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'docs/security.md'), 'The service does not store passwords.');
    const r = await call(fx, 'check_answer', { answer: 'The service stores passwords.', citations: [{ ref: 'docs/security.md', excerpt: 'The service does not store passwords.' }] });
    assert.equal(r.ok, false);
    assert.equal(r.claimSupport.status, 'contradicted');
  } finally { fx.cleanup(); }
});

test('independent disagreement and changed source bytes stay visible instead of fabricated consensus', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'docs/a.md'), 'The service stores passwords.');
    writeFileSync(join(fx.box.cwd, 'docs/b.md'), 'The service does not store passwords.');
    const answer = 'The service stores passwords.';
    const check = () => call(fx, 'check_answer', { answer, citations: [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }], claims: [{ claim: answer, refs: ['docs/a.md', 'docs/b.md'] }] });
    const first = await check();
    assert.equal(first.claimSupport.results[0].status, 'unknown');
    assert.match(first.claimSupport.results[0].basis, /disagree/);
    const before = first.claimSupport.results[0].evidence[1].digest;
    writeFileSync(join(fx.box.cwd, 'docs/b.md'), 'The service stores passwords.');
    const second = await check();
    assert.equal(second.claimSupport.results[0].status, 'supported');
    assert.notEqual(second.claimSupport.results[0].evidence[1].digest, before);
    assert.equal(second.claimSupport.results[0].evidence.length, 2);
    const forged = await call(fx, 'check_answer', { answer, citations: [{ ref: 'docs/a.md' }], claims: [{ claim: 'The service encrypts passwords.', refs: ['docs/a.md'] }] });
    assert.equal(forged.ok, false, 'a different, easier claim cannot certify this answer');
  } finally { fx.cleanup(); }
});

test('arithmetic support requires mapped units, complete coverage and the exact typed proposition', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'docs/units.md'), 'Counts measure cases per row.');
    await call(fx, 'sources', { action: 'declare', id: 'stock', kind: 'other' });
    const report = async (complete: boolean, unit = 'cases', n = 4) => call(fx, 'sources', { action: 'report', id: 'stock', coverage: { complete }, partial: !complete, items: [{ ref: 'inventory', text: JSON.stringify([{ sku: 'A', count: 12 }, { sku: 'B', count: n }]), schema: { type: 'array', items: { type: 'object', properties: { count: { type: 'number', unit } } } } }] });
    await report(true);
    await call(fx, 'sources', { action: 'map', id: 'stock', mapping: { item: 'inventory', records: '', identity: '/sku', fields: [{ name: 'stock', path: '/count', type: 'number', unit: 'cases' }], evidence: ['docs/units.md'] } });
    const check = (expected = 16, text = `Total stock is ${String(expected)} cases.`) => call(fx, 'check_answer', { answer: text, citations: [{ ref: 'stock:inventory' }], claims: [{ claim: text, refs: ['stock:inventory'], calculation: { sourceId: 'stock', item: 'inventory', field: 'stock', operation: 'sum', expected, unit: 'cases' } }] });
    assert.equal((await check()).claimSupport.results[0].status, 'supported');
    assert.equal((await check()).ok, true, JSON.stringify(await check()));
    assert.equal((await check(17)).claimSupport.results[0].status, 'contradicted');
    assert.equal((await check(16, 'Total stock is 12 cases.')).claimSupport.results[0].status, 'unknown');
    assert.equal((await check(16, 'Total stock is more than 16 cases.')).claimSupport.results[0].status, 'unknown');
    await report(false);
    assert.equal((await check()).claimSupport.results[0].status, 'unknown');
    await report(true, 'pallets');
    assert.equal((await check()).claimSupport.results[0].status, 'unknown');
    await report(true, 'cases', 3);
    assert.equal((await check()).claimSupport.results[0].status, 'contradicted');
  } finally { fx.cleanup(); }
});
