/**
 * tests/functional/chat-render.functional.test.mjs — verify the accessible chat
 * renderer and transparency layer gating.
 *
 * Feeds a fake driver's normalized event stream through renderTurn and asserts
 * that every signal carries a text label (color-independent meaning), that
 * NO_COLOR yields plain output with no escape codes, and that disabling a layer
 * removes its events from the rendered transcript while structural channels
 * remain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { AsyncEventQueue } from '../../lib/chat/harness/driver.mjs';
import { resolveColors } from '../../lib/term-format.mjs';
import { renderTurn } from '../../lib/chat/tui/render.mjs';
import { resolveLayers } from '../../lib/chat/transparency.mjs';

function collector() {
  let out = '';
  const stream = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
  return { stream, get text() { return out; } };
}

function fakeDriver(events) {
  return {
    prompt() {
      const q = new AsyncEventQueue();
      for (const e of events) q.push(e);
      q.push({ type: 'done', stopReason: 'end_turn' });
      q.close();
      return q;
    },
  };
}

const SAMPLE = [
  { type: 'thinking', text: 'reasoning here' },
  { type: 'tool_call', id: 't1', title: 'read', kind: 'read' },
  { type: 'tool_update', id: 't1', status: 'completed' },
  { type: 'text', text: 'final answer' },
];

const NO_PLAN = { path: false, specialists: false };

test('renderer labels every channel and respects NO_COLOR', async () => {
  const env = { NO_COLOR: '1' };
  const layers = { ...resolveLayers({ flags: NO_PLAN, env }), ...NO_PLAN };
  const out = collector();
  const colors = resolveColors({ stream: out.stream, env });

  await renderTurn({ driver: fakeDriver(SAMPLE), text: 'hi', layers, output: out.stream, colors, env });

  assert.ok(out.text.includes('[thinking]'), 'thinking labeled');
  assert.ok(out.text.includes('[tool]'), 'tool labeled');
  assert.ok(out.text.includes('construct'), 'assistant text labeled');
  assert.ok(out.text.includes('final answer'));
  assert.ok(!/\u001b\[/.test(out.text), 'no ANSI escapes under NO_COLOR');
});

test('disabling the thinking layer removes thinking but keeps message', async () => {
  const env = { NO_COLOR: '1' };
  const layers = { ...resolveLayers({ flags: { ...NO_PLAN, thinking: false }, env }), ...NO_PLAN };
  const out = collector();
  const colors = resolveColors({ stream: out.stream, env });

  await renderTurn({ driver: fakeDriver(SAMPLE), text: 'hi', layers, output: out.stream, colors, env });

  assert.ok(!out.text.includes('[thinking]'), 'thinking hidden when layer off');
  assert.ok(out.text.includes('final answer'), 'message still shown');
});
