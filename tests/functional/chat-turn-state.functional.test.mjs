/**
 * tests/functional/chat-turn-state.functional.test.mjs — pure turn-state reduction for chat.
 *
 * Verifies lib/chat/tui/turn-state.mjs against the normalized driver event union
 * without Ink, network, or API keys.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnState, applyTurnEvent, runTurnInto } from '../../lib/chat/tui/turn-state.mjs';
import { createSessionUsage, addUsage } from '../../lib/chat/tui/usage.mjs';

function fakeDriver(events) {
  return {
    prompt() {
      return (async function* gen() { for (const e of events) yield e; })();
    },
  };
}

test('turn-state reduces the event union into renderable channels', () => {
  const session = { usage: createSessionUsage() };
  const state = createTurnState();
  for (const e of [
    { type: 'thinking', text: 'plan' },
    { type: 'text', text: 'answer ' },
    { type: 'text', text: 'here' },
    { type: 'tool_call', id: 'a', title: 'read' },
    { type: 'tool_update', id: 'a', status: 'completed' },
    { type: 'usage', tokens: { input: 50, output: 10, total: 60 } },
    { type: 'done', stopReason: 'end_turn' },
  ]) applyTurnEvent(state, e, { session });

  assert.equal(state.thinking, 'plan');
  assert.equal(state.assistant, 'answer here');
  assert.equal(state.tools[0].status, 'completed');
  assert.equal(state.stopReason, 'end_turn');
  assert.equal(session.usage.tokens.total, 60);
  assert.equal(session.usage.turns, 1);
});

test('runTurnInto drives a turn to completion and reports updates', async () => {
  const session = { usage: createSessionUsage() };
  const updates = [];
  const driver = fakeDriver([
    { type: 'text', text: 'hi' },
    { type: 'usage', tokens: { input: 5, output: 1, total: 6 } },
    { type: 'done', stopReason: 'end_turn' },
  ]);
  const state = await runTurnInto(driver, 'q', {}, { session, onUpdate: (_s, e) => updates.push(e.type) });
  assert.equal(state.assistant, 'hi');
  assert.deepEqual(updates, ['text', 'usage', 'done']);
});

test('runTurnInto respects transparency layers', async () => {
  const session = { usage: createSessionUsage() };
  const driver = fakeDriver([
    { type: 'thinking', text: 'hidden' },
    { type: 'text', text: 'visible' },
    { type: 'usage', tokens: { input: 1, total: 1 } },
    { type: 'done', stopReason: 'end_turn' },
  ]);
  const state = await runTurnInto(driver, 'q', {}, {
    session,
    layers: { thinking: false, path: true, specialists: true, tools: true, observability: false },
  });
  assert.equal(state.thinking, '');
  assert.equal(state.assistant, 'visible');
  assert.equal(session.usage.turns, 0);
});

test('addUsage never crashes a turn on a malformed accumulator', () => {
  // Regression: the web loop once passed the whole session (no top-level .tokens)
  // where the usage accumulator was expected, so addInto hit Object.keys(undefined)
  // and threw "Cannot convert undefined or null to object" mid-turn. addInto now
  // tolerates any non-object target.
  const sessionShaped = { model: 'x', usage: createSessionUsage() };
  assert.doesNotThrow(() => addUsage(sessionShaped, { tokens: { input: 5, total: 5 } }));
  assert.doesNotThrow(() => addUsage(null, { tokens: { input: 1 } }));
});

test('runTurnInto accumulates a turn usage event exactly once', () => {
  const session = { usage: createSessionUsage() };
  const state = createTurnState();
  applyTurnEvent(state, { type: 'usage', tokens: { input: 30, output: 10, total: 40 } }, { session });
  assert.equal(session.usage.tokens.total, 40);
  assert.equal(session.usage.turns, 1);
});

test('turn-state records permission events', () => {
  const state = createTurnState();
  applyTurnEvent(state, { type: 'permission', toolCall: { title: 'shell' }, options: ['allow', 'reject'] });
  assert.equal(state.permissions.length, 1);
  assert.equal(state.permissions[0].title, 'shell');
});
