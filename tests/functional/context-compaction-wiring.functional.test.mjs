/**
 * tests/functional/context-compaction-wiring.functional.test.mjs — the live wiring
 * of the context-continuation contract across the real owned-loop surfaces
 * (construct-6zga.1.10).
 *
 * Drives the real modules end-to-end — maybeCompact builds a packet from a live
 * message history, the owned-loop driver maps the engine's continuation parts onto
 * the normalized event union, the packet rides a turn block through the real
 * persist/restore serialization, resume rehydrates it through the one shared
 * resolver, and export renders it the same way — and asserts on durable artifacts
 * (the restored packet and the written export file) in an isolated tmpdir.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOwnedLoopDriver } from '../../apps/chat/engine/loop-driver.mjs';
import { maybeCompact } from '../../lib/chat/context-compactor.mjs';
import { validateContinuationPacket } from '../../lib/chat/context-continuation.mjs';
import { createTurnBlock, applyEventToTurn, serializeBlock, restoreBlocksFromSessionLines } from '../../lib/chat/tui/turn-block.mjs';
import { restoreFromSession } from '../../lib/chat/session-restore.mjs';
import { exportTurns } from '../../lib/chat/export.mjs';

const tmpDirs = [];
function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function longConversation() {
  const big = (p, n) => `${p} ${'x'.repeat(n)}`;
  return [
    { role: 'user', content: 'TASK: implement the widget with AC1..AC3' },
    { role: 'assistant', content: [{ type: 'text', text: big('A1', 400) }, { type: 'tool-call', toolName: 'read', toolCallId: 't1', input: { path: 'a' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'read', toolCallId: 't1', output: 'r'.repeat(400) }] },
    { role: 'assistant', content: big('A2', 400) },
    { role: 'user', content: 'CONSTRAINT: never touch staging' },
    { role: 'assistant', content: big('A3', 400) },
    { role: 'assistant', content: big('A4 most recent', 80) },
  ];
}

async function realPacket() {
  const outcome = await maybeCompact({
    messages: longConversation(),
    systemText: 'CONSTRUCT SYSTEM RULES',
    triggerTokens: 120,
    contextTokens: 800,
    summarize: async () => 'Read a.txt; drafted the widget; AC2 still open.',
  });
  assert.equal(outcome.compacted, true, 'fixture must cross the trigger and compact');
  assert.ok(validateContinuationPacket(outcome.packet).valid);
  return outcome;
}

test('the owned-loop driver maps continuation parts onto the normalized event union', async () => {
  const { packet } = await realPacket();
  const createAgent = async () => ({
    sessionId: 's',
    async *streamTurn() {
      yield { type: 'text-delta', text: 'done' };
      yield { type: 'context-continuation', packet, compacted: true };
      yield { type: 'context-notice', level: 'info', code: 'context-compacted', message: 'Context compacted: summarized 5 earlier message(s).' };
    },
  });
  const driver = createOwnedLoopDriver({ createAgent });
  await driver.start();

  const events = [];
  for await (const e of driver.prompt('go')) events.push(e);

  const notice = events.find((e) => e.type === 'notice');
  assert.ok(notice, 'a notice event must reach the surface');
  assert.match(notice.message, /Context compacted/);

  const cont = events.find((e) => e.type === 'context_continuation');
  assert.ok(cont, 'the continuation packet must reach the surface');
  assert.equal(cont.compacted, true);
  assert.ok(validateContinuationPacket(cont.packet).valid);
});

test('the continuation packet rides a turn block through persist/restore', async () => {
  const { packet, notice } = await realPacket();
  const turn = createTurnBlock('do the work');
  applyEventToTurn(turn, { type: 'context_continuation', packet });
  applyEventToTurn(turn, { type: 'notice', message: notice });
  assert.equal(turn.continuation, packet);
  assert.ok(turn.notices.includes(notice));

  const row = JSON.stringify(serializeBlock(turn));
  const blocks = restoreBlocksFromSessionLines([row]);
  const restored = blocks.find((b) => b.kind === 'turn')?.block;
  assert.ok(restored, 'turn block round-trips');
  assert.deepEqual(restored.continuation, packet, 'packet survives serialization');
  assert.ok(restored.notices.includes(notice), 'notice survives serialization');
});

test('resume rehydrates the packet through the shared resolver (AC3)', async () => {
  const { packet } = await realPacket();
  const turn = createTurnBlock('do the work');
  applyEventToTurn(turn, { type: 'context_continuation', packet });

  const tmp = mkTmp('cx-continuation-');
  const file = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'session_start', host: 'construct' }),
    JSON.stringify(serializeBlock(turn)),
  ].join('\n'));

  const restored = restoreFromSession(file, { cwd: tmp });
  assert.equal(restored.continuations.length, 1, 'resume surfaces the continuation');
  const sys = restored.continuations[0].layers.find((l) => l.kind === 'static-instructions');
  assert.ok(sys, 'the reconstructible system layer is present');
  assert.equal(sys.resolved, true, 'it re-derives through the composer, not stored content');
  assert.ok(typeof sys.content === 'string' && sys.content.length > 0);
});

test('export renders the continuation through the same resolver (AC3)', async () => {
  const { packet } = await realPacket();
  const turn = createTurnBlock('do the work');
  turn.assistant = 'final answer';
  applyEventToTurn(turn, { type: 'context_continuation', packet });

  const tmp = mkTmp('cx-export-');
  const result = exportTurns([{ kind: 'turn', block: turn }], { scope: 'last', cwd: tmp });
  assert.equal(result.ok, true);

  const md = fs.readFileSync(result.path, 'utf8');
  assert.match(md, /context continuation/);
  assert.match(md, /compacted to fit/);
  assert.match(md, /static-instructions: re-derived from prompt:system/);
});
