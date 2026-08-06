/**
 * tests/cli/log-reasons.test.ts — the log shows the reason it recorded.
 *
 * The store holds the whole detail on failure and degradation entries; a
 * reading surface that prints only the action name defeats the append-only
 * record, because the reason then survives only in the terminal that produced
 * it. These tests pin the reason clause for the known reason-bearing kinds
 * and pin that it stays a clause — one line per entry, no detail dump — and
 * that the whole path from a failing namer to `construct log` output carries
 * the reason end to end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { main, reasonClause } from '../../src/cli/index.ts';
import { sterile } from '../harness/sterile.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { startRunNamed } from '../../src/kernel/run/outcome.ts';

test('namer-failed renders its recorded failure and the fallback that answered', () => {
  const clause = reasonClause('namer-failed', {
    failure: 'the host replied with malformed JSON',
    fellBackTo: 'keywords',
  });
  assert.match(clause, /the host replied with malformed JSON/);
  assert.match(clause, /fell back to keywords/);
});

test('model-untuned-best-effort names the model and the missing tuning evidence', () => {
  const clause = reasonClause('model-untuned-best-effort', { model: 'ollama/qwen3.5:4b' });
  assert.match(clause, /ollama\/qwen3\.5:4b/);
  assert.match(clause, /best-effort/);
});

test('namer-retried says what the first reply failed with', () => {
  const clause = reasonClause('namer-retried', { firstFailure: 'no JSON object' });
  assert.match(clause, /no JSON object/);
  assert.match(clause, /corrective retry/);
});

test('the other known reason-bearing kinds each render their recorded reason', () => {
  assert.match(reasonClause('model-floor-degraded', { why: 'brief declares a "high" floor' }), /high/);
  assert.match(reasonClause('extraction-refused', { reason: 'binary format' }), /binary format/);
  assert.match(reasonClause('role-failed', { error: 'host timed out' }), /host timed out/);
  assert.match(reasonClause('dispatch-halted', { reason: 'spend ceiling reached' }), /spend ceiling/);
});

test('a reason-bearing entry with a missing detail still renders honestly, and a routine entry adds nothing', () => {
  assert.match(reasonClause('namer-failed', null), /reason not recorded/);
  assert.equal(reasonClause('outcome-received', { outcome: 'x' }), '');
  assert.equal(reasonClause('domain-implicated', { inferredBy: 'namer' }), '');
});

test('the reason survives from a failing namer to the log command output', async () => {
  const fixture = sterile();
  const previous = process.env.XDG_DATA_HOME;
  const share = join(fixture.root, 'share');
  process.env.XDG_DATA_HOME = share;
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(share, 'construct'), { recursive: true });
    const store = openStore(join(share, 'construct', 'construct.db'));
    await startRunNamed(store, {
      runId: 'run-log-reason',
      outcome: 'Adopt a new payroll provider',
      at: '2026-08-06T00:00:00.000Z',
      host: 'test-host',
      namer: () => Promise.reject(new Error('the host replied with malformed JSON')),
    });
    store.close();
    const code = await main(['log', '--run', 'run-log-reason']);
    assert.equal(code, 0);
    const text = out.join('');
    const line = text.split('\n').find((l) => l.includes('namer-failed'));
    assert.ok(line, 'the namer-failed entry is in the log output');
    assert.match(line, /the host replied with malformed JSON/);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    fixture.cleanup();
  }
});
