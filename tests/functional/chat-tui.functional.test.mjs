/**
 * tests/functional/chat-tui.functional.test.mjs — the rich surface's pure state
 * reduction and its Ink projection.
 *
 * The Ink app is a thin projection of the turn-state reducer (apps/chat/tui/
 * turn-state.mjs), so the renderable state math is verified directly with a fake
 * driver, and the React/Ink layer is verified by rendering the built bundle's
 * TransparencyPanel through ink-testing-library. Together these cover the surface
 * without a model, network, or API key, and confirm the esbuild bundle the
 * launcher loads actually mounts under the optional ink/react dependencies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { createTurnState, applyTurnEvent, runTurnInto } from '../../apps/chat/tui/turn-state.mjs';
import { createSessionUsage } from '../../lib/chat/tui/usage.mjs';
import { createTheme } from '../../apps/chat/tui/theme.mjs';
import { TransparencyPanel, TurnContextBar, TurnView } from '../../apps/chat/dist/tui.mjs';

const PANEL_THEME = createTheme();

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

test('turn-state records permission events', () => {
  const state = createTurnState();
  applyTurnEvent(state, { type: 'permission', toolCall: { title: 'shell' }, options: ['allow', 'reject'] });
  assert.equal(state.permissions.length, 1);
  assert.equal(state.permissions[0].title, 'shell');
});

test('SessionDock renders session usage and model', () => {
  const session = { usage: createSessionUsage() };
  applyTurnEvent(createTurnState(), { type: 'usage', tokens: { input: 1200, output: 300, total: 1500 } }, { session });

  const { lastFrame } = render(
    React.createElement(TransparencyPanel, {
      width: 40,
      session,
      layers: { thinking: true, path: true, specialists: true, tools: true, observability: true },
      working: false,
      model: 'anthropic/claude-sonnet-4-6',
      theme: PANEL_THEME,
    }),
  );
  const frame = lastFrame();
  assert.match(frame, /session/);
  assert.match(frame, /anthropic\/claude-sonnet-4-6/);
  assert.match(frame, /layers/);
});

test('TurnContextBar renders route and external research badge', () => {
  const turn = {
    overlay: {
      intent: 'research',
      workCategory: 'competitive-analysis',
      specialists: ['cx-researcher'],
      externalResearch: { required: true, shape: 'landscape' },
    },
    sources: [{ tool: 'read', ref: 'docs/adr/0015.md' }],
  };
  const { lastFrame } = render(
    React.createElement(TurnContextBar, {
      turn,
      width: 50,
      layers: { specialists: true },
      palette: PANEL_THEME.palette,
      glyphs: PANEL_THEME.glyphs,
    }),
  );
  const frame = lastFrame();
  assert.match(frame, /ROUTE/);
  assert.match(frame, /intent/);
  assert.match(frame, /route/);
  assert.match(frame, /research/);
  assert.match(frame, /SOURCES/);
  assert.match(frame, /docs\/adr\/0015.md/);
});

test('TurnTranscript renders full thinking inline with phase labels', () => {
  const turn = {
    id: 't1',
    userText: 'what is pending for oracle',
    overlay: { intent: 'implementation', workCategory: 'quick', specialists: ['cx-researcher'] },
    thinking: 'The user is asking about oracle pending work.\nLine two.\nLine three.',
    tools: [{ id: 'a', title: 'glob', status: 'completed', input: { pattern: '**/*oracle*' } }],
    sources: [{ tool: 'glob', ref: '**/*oracle*' }],
    assistant: 'Here is the summary.',
    usage: { tokens: { input: 2000, output: 481, total: 2481 } },
  };
  const { lastFrame } = render(
    React.createElement(TurnView, {
      turn,
      width: 60,
      layers: { thinking: true, tools: true, specialists: true, observability: true },
      turnIndex: 1,
      theme: PANEL_THEME,
    }),
  );
  const frame = lastFrame();
  assert.match(frame, /TURN 1/);
  assert.match(frame, /ROUTE/);
  assert.match(frame, /THINKING/);
  assert.match(frame, /The user is asking about oracle/);
  assert.match(frame, /TOOLS/);
  assert.match(frame, /CONSTRUCT/);
  assert.match(frame, /USAGE/);
  assert.doesNotMatch(frame, /inspector/);
});
