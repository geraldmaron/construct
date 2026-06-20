/**
 * tests/functional/chat-turn-block.functional.test.mjs — turn block model and reducer order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTurnBlock,
  applyOverlayToTurn,
  applyEventToTurn,
  finalizeTurn,
  flattenTurnBlocks,
  snapshotTurn,
  restoreBlocksFromSessionLines,
} from '../../lib/chat/tui/turn-block.mjs';

test('turn block orders overlay, thinking, tools, assistant, usage', () => {
  const turn = createTurnBlock('compare CrewAI');
  applyOverlayToTurn(turn, {
    intent: 'research',
    workCategory: 'competitive-analysis',
    specialists: ['cx-researcher', 'cx-product-manager'],
    externalResearch: { required: true, shape: 'landscape' },
    contractChain: [{ id: 'e1', producer: 'cx-researcher', consumer: 'cx-product-manager' }],
    dispatchReasons: { 'cx-researcher': 'signal' },
    triggers: [{ specialist: 'cx-researcher', reason: 'research' }],
    dispatchSummary: 'handoff planned',
  });
  applyEventToTurn(turn, { type: 'thinking', text: 'scan docs' });
  applyEventToTurn(turn, { type: 'tool_call', id: 't1', title: 'grep', input: { pattern: 'CrewAI', path: 'docs/' } });
  applyEventToTurn(turn, { type: 'tool_update', id: 't1', status: 'completed' });
  applyEventToTurn(turn, { type: 'text', text: '# Answer\n\nDone.' });
  applyEventToTurn(turn, { type: 'usage', tokens: { input: 10, output: 5, total: 15 } });

  const flat = flattenTurnBlocks([{ kind: 'turn', block: turn }]);
  const types = flat.map((p) => p.type);
  assert.deepEqual(types, ['user', 'turn_context', 'thinking', 'tool', 'assistant', 'turn_usage']);
  assert.equal(flat[1].overlay.intent, 'research');
  assert.equal(flat[1].overlay.dispatchSummary, 'handoff planned');
  assert.equal(flat[1].overlay.contractChain.length, 1);
  assert.equal(flat[3].title, 'grep');
});

test('finalizeTurn adds unverified notice when research required but no sources', () => {
  const turn = createTurnBlock('landscape');
  applyOverlayToTurn(turn, { externalResearch: { required: true } });
  finalizeTurn(turn);
  assert.ok(turn.notices.some((n) => /unverified/i.test(n)));
});

test('tool events populate source ledger without fabrication', () => {
  const turn = createTurnBlock('q');
  applyEventToTurn(turn, { type: 'tool_call', id: 'r1', title: 'read', input: { path: 'docs/adr/0015.md' } });
  assert.equal(turn.sources.length, 1);
  assert.equal(turn.sources[0].ref, 'docs/adr/0015.md');
});

test('transcript_block rows restore turn snapshots', () => {
  const turn = createTurnBlock('hello');
  turn.assistant = 'hi';
  const row = JSON.stringify({ type: 'transcript_block', block: snapshotTurn(turn) });
  const blocks = restoreBlocksFromSessionLines([row]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block.userText, 'hello');
  assert.equal(blocks[0].block.assistant, 'hi');
});
