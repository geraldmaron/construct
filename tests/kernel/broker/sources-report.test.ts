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
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
import { REPORTED_TEXT_CAP } from '../../../src/kernel/source/service.ts';
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
    assert.match(r.next, /first 16 KiB of the text of runbook/);
    assert.match(r.next, /report the passage you rely on as its own item/);
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

test('an excerpt a step hands back is kept without credentials', () => {
  const t = tool('submit_work');
  const input = t.validate(record({ stepRunId: 'step-1', token: 'tok', output: {}, evidence: [{ ref: 'docs/design.md', excerpt: `deploy with ${SECRET} today` }, { ref: 'docs/design.md' }] })) as { evidence: { ref: string; excerpt?: string }[] };
  assert.equal(input.evidence[0]!.excerpt, 'deploy with [redacted] today');
  assert.equal(input.evidence[1]!.excerpt, undefined);
});
