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
import { createTurnState, applyTurnEvent, runTurnInto } from '../../apps/chat/tui/turn-state.mjs';
import { createSessionUsage } from '../../lib/chat/tui/usage.mjs';
import { createTheme } from '../../apps/chat/tui/theme.mjs';

const INK_SKIP = Number(process.versions.node.split('.')[0]) < 22
  ? 'ink 7 requires Node >= 22'
  : false;

async function loadInkHarness() {
  const React = (await import('react')).default;
  const { render } = await import('ink-testing-library');
  const tui = await import('../../apps/chat/dist/tui.mjs');
  const theme = createTheme();
  return { React, render, theme, tui };
}

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

test('SessionDock renders session usage and model', { skip: INK_SKIP }, async () => {
  const { React, render, theme, tui } = await loadInkHarness();
  const session = { usage: createSessionUsage() };
  applyTurnEvent(createTurnState(), { type: 'usage', tokens: { input: 1200, output: 300, total: 1500 } }, { session });

  const { lastFrame } = render(
    React.createElement(tui.TransparencyPanel, {
      width: 40,
      session,
      layers: { thinking: true, path: true, specialists: true, tools: true, observability: true },
      working: false,
      model: 'anthropic/claude-sonnet-4-6',
      theme,
    }),
  );
  const frame = lastFrame();
  assert.match(frame, /session/);
  assert.match(frame, /anthropic\/claude-sonnet-4-6/);
  assert.match(frame, /layers/);
});

test('TurnContextBar renders route and external research badge', { skip: INK_SKIP }, async () => {
  const { React, render, theme, tui } = await loadInkHarness();
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
    React.createElement(tui.TurnContextBar, {
      turn,
      width: 50,
      layers: { specialists: true },
      palette: theme.palette,
      glyphs: theme.glyphs,
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

test('TurnTranscript renders full thinking inline with phase labels', { skip: INK_SKIP }, async () => {
  const { React, render, theme, tui } = await loadInkHarness();
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
    React.createElement(tui.TurnView, {
      turn,
      width: 60,
      layers: { thinking: true, tools: true, specialists: true, observability: true },
      turnIndex: 1,
      theme,
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

test('CompactTurnLog renders mono channel lines', { skip: INK_SKIP }, async () => {
  const { React, render, theme, tui } = await loadInkHarness();
  const turn = {
    id: 't2',
    userText: 'fix the hook',
    overlay: { intent: 'implementation', specialists: ['cx-engineer'] },
    thinking: 'Checking hooks.',
    tools: [{ id: 'b', title: 'read', status: 'completed', input: { path: 'lib/hooks/foo.mjs' } }],
    sources: ['lib/hooks/foo.mjs'],
    assistant: 'Done.',
    usage: { tokens: { total: 100 } },
  };
  const { lastFrame } = render(
    React.createElement(tui.CompactTurnLog, {
      turn,
      width: 70,
      layers: { thinking: true, tools: true, specialists: true, observability: true },
      turnIndex: 2,
      theme,
    }),
  );
  const frame = lastFrame();
  assert.match(frame, /T2/);
  assert.match(frame, /YOU/);
  assert.match(frame, /ROUTE/);
  assert.match(frame, /THINK/);
  assert.match(frame, /TOOL/);
  assert.match(frame, /OUT/);
  assert.match(frame, /USAGE/);
  assert.doesNotMatch(frame, /TURN 2/);
});
