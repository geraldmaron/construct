/**
 * tests/functional/chat-owned-loop.functional.test.mjs — the owned-loop driver
 * (apps/chat/engine/loop-driver.mjs) against a scripted mock engine.
 *
 * ADR-0041 makes Construct's owned loop just another driver implementing the
 * normalized event union. This test drives the real mapping/lifecycle code with an
 * injected mock `createAgent` that yields Vercel-AI-SDK-shaped fullStream parts, so
 * the contract is verified with no network, API key, or optional SDK dependency.
 * Asserts the union events (thinking, text, tool_call/tool_update, normalized
 * usage, done) and the cancel path, mirroring the dependency-injection discipline
 * the retired host adapters used.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedLoopDriver } from '../../apps/chat/engine/loop-driver.mjs';

function mockAgent(parts) {
  return async () => ({
    sessionId: 'mock-session',
    model: 'anthropic/claude-test',
    async *streamTurn() { for (const p of parts) yield p; },
  });
}

test('maps fullStream parts onto the normalized event union', async () => {
  const parts = [
    { type: 'reasoning-delta', text: 'let me think' },
    { type: 'text-delta', text: 'Hello ' },
    { type: 'text-delta', text: 'world' },
    { type: 'tool-call', toolCallId: 't1', toolName: 'read', input: { path: 'a.txt' } },
    { type: 'tool-result', toolCallId: 't1', output: { ok: true, content: 'x' } },
    { type: 'finish', totalUsage: { inputTokens: 120, outputTokens: 30, reasoningTokens: 8, totalTokens: 158 } },
  ];
  const driver = createOwnedLoopDriver({ createAgent: mockAgent(parts) });
  const started = await driver.start();
  assert.equal(started.capabilities.ownedLoop, true);

  const events = [];
  for await (const e of driver.prompt('hi')) events.push(e);

  const byType = (t) => events.filter((e) => e.type === t);
  assert.equal(byType('thinking')[0].text, 'let me think');
  assert.equal(byType('text').map((e) => e.text).join(''), 'Hello world');

  const call = byType('tool_call')[0];
  assert.equal(call.id, 't1');
  assert.equal(call.title, 'read');

  const update = byType('tool_update')[0];
  assert.equal(update.id, 't1');
  assert.equal(update.status, 'completed');

  const usage = byType('usage')[0];
  assert.equal(usage.tokens.input, 120);
  assert.equal(usage.tokens.output, 30);
  assert.equal(usage.tokens.reasoning, 8);
  assert.equal(usage.tokens.total, 158);

  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.stopReason, 'end_turn');
});

test('derives a total when the engine omits totalTokens', async () => {
  const driver = createOwnedLoopDriver({
    createAgent: mockAgent([{ type: 'finish', usage: { inputTokens: 10, outputTokens: 4 } }]),
  });
  await driver.start();
  const events = [];
  for await (const e of driver.prompt('x')) events.push(e);
  const usage = events.find((e) => e.type === 'usage');
  assert.equal(usage.tokens.total, 14);
});

test('surfaces an engine error as error + done(error)', async () => {
  const driver = createOwnedLoopDriver({
    createAgent: mockAgent([{ type: 'error', error: new Error('boom') }]),
  });
  await driver.start();
  const events = [];
  for await (const e of driver.prompt('x')) events.push(e);
  assert.equal(events.find((e) => e.type === 'error').message, 'boom');
  assert.equal(events.at(-1).stopReason, 'error');
});

test('cancel() ends the turn with done(cancelled)', async () => {
  const createAgent = async () => ({
    sessionId: 's',
    async *streamTurn(_text, { signal } = {}) {
      yield { type: 'text-delta', text: 'partial' };
      await new Promise((_resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });
  const driver = createOwnedLoopDriver({ createAgent });
  await driver.start();

  const queue = driver.prompt('go');
  const events = [];
  for await (const e of queue) {
    events.push(e);
    if (e.type === 'text') driver.cancel();
  }
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).stopReason, 'cancelled');
});
