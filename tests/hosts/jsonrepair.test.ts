/**
 * tests/hosts/jsonrepair.test.ts — the one-corrective-retry seam.
 *
 * The contract has three edges worth pinning: only a PARSE failure retries (a
 * broken host is not a malformed reply), the retry happens exactly once, and a
 * repaired answer says it was repaired. The stub host counts invocations so a
 * silent extra model call cannot hide.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeWithRepair,
  repairPrompt,
  stripThinkBlocks,
} from '../../src/hosts/jsonrepair.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

function sequenceHost(replies: readonly Partial<HostResult>[]): {
  host: HostAdapter;
  calls: () => number;
  tasks: () => readonly string[];
} {
  let n = 0;
  const tasks: string[] = [];
  const host: HostAdapter = {
    name: 'stub',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (invocation): Promise<HostResult> => {
      tasks.push((invocation as { task: string }).task);
      const reply = replies[Math.min(n, replies.length - 1)];
      n += 1;
      return { id: 'x', status: 'ok', output: null, error: null, ...reply };
    },
  };
  return { host, calls: () => n, tasks: () => tasks };
}

const parse = (text: string): unknown => JSON.parse(text);

test('a clean first reply parses in one call and reports no retry', async () => {
  const { host, calls } = sequenceHost([{ output: { text: '{"ok":true}' } }]);
  const reply = await invokeWithRepair(host, 'role', 'prompt', parse);
  assert.deepEqual(reply.value, { ok: true });
  assert.equal(reply.retried, false);
  assert.equal(reply.firstFailure, undefined);
  assert.equal(calls(), 1);
});

test('a malformed first reply gets exactly one corrective retry, and the repair is reported', async () => {
  const { host, calls, tasks } = sequenceHost([
    { output: { text: 'not json at all' } },
    { output: { text: '{"ok":true}' } },
  ]);
  const reply = await invokeWithRepair(host, 'role', 'the original ask', parse);
  assert.deepEqual(reply.value, { ok: true });
  assert.equal(reply.retried, true);
  assert.ok(reply.firstFailure && reply.firstFailure.length > 0);
  assert.equal(calls(), 2);
  // The corrective turn carries the original ask, the failed reply, and the
  // parser's complaint — the model corrects its own mistake, not a fresh task.
  const corrective = tasks()[1];
  assert.ok(corrective.includes('the original ask'));
  assert.ok(corrective.includes('not json at all'));
});

test('two malformed replies throw, and the error names the retry', async () => {
  const { host, calls } = sequenceHost([
    { output: { text: 'garbage one' } },
    { output: { text: 'garbage two' } },
  ]);
  await assert.rejects(
    () => invokeWithRepair(host, 'role', 'prompt', parse),
    /after one corrective retry/,
  );
  assert.equal(calls(), 2);
});

test('a host error does not retry: reprompting a broken host pays twice for nothing', async () => {
  const { host, calls } = sequenceHost([{ status: 'error' }]);
  await assert.rejects(() => invokeWithRepair(host, 'role', 'prompt', parse), /status error/);
  assert.equal(calls(), 1);
});

test('a host error on the corrective turn propagates without a second retry', async () => {
  const { host, calls } = sequenceHost([
    { output: { text: 'not json' } },
    { status: 'error' },
  ]);
  await assert.rejects(() => invokeWithRepair(host, 'role', 'prompt', parse), /status error/);
  assert.equal(calls(), 2);
});

test('the repair prompt states the failure and forbids everything but the object', () => {
  const prompt = repairPrompt('ask', 'bad reply', 'unexpected token');
  assert.ok(prompt.includes('ask'));
  assert.ok(prompt.includes('bad reply'));
  assert.ok(prompt.includes('unexpected token'));
  assert.ok(/ONLY the corrected JSON/.test(prompt));
});

test('think blocks are stripped, including their braces', () => {
  const text = '<think>reasoning {with braces}</think>{"ok":true}';
  assert.equal(stripThinkBlocks(text), '{"ok":true}');
});
