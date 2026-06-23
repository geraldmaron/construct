/**
 * tests/context-compactor.test.mjs — unit coverage for the live-context bridge
 * (lib/chat/context-compactor.mjs, construct-6zga.1.10).
 *
 * Proves the owned-loop message history maps onto the contract inventory, that
 * compaction rebuilds a provider-valid array (first message user, no adjacent
 * same-role turns, no orphan tool results), that every user turn survives verbatim
 * (no silent loss), that the elided assistant/tool work is summarized through the
 * injected summarizer with a deterministic fallback, and that required state over
 * budget surfaces a blocker without mutating the history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentMessages, buildInventory, rebuildMessages, shouldCompact, maybeCompact,
  messageText, validateContinuationPacket,
} from '../lib/chat/context-compactor.mjs';

function bigText(prefix, n) {
  return `${prefix} ${'x'.repeat(n)}`;
}

function fixture() {
  return [
    { role: 'user', content: 'TASK: implement the widget with AC1..AC3' },
    { role: 'assistant', content: [{ type: 'text', text: bigText('A1 reasoning', 400) }, { type: 'tool-call', toolName: 'read', toolCallId: 't1', input: { path: 'a.txt' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'read', toolCallId: 't1', output: { data: 'r'.repeat(400) } }] },
    { role: 'assistant', content: bigText('A2 reasoning', 400) },
    { role: 'user', content: 'CONSTRAINT: never touch staging' },
    { role: 'assistant', content: bigText('A3 reasoning', 400) },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'grep', toolCallId: 't2', output: 'g'.repeat(400) }] },
    { role: 'assistant', content: bigText('A4 most recent answer', 80) },
  ];
}

function assertProviderValid(messages) {
  assert.equal(messages[0].role, 'user', 'first message must be user');
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1].role;
    const cur = messages[i].role;
    if ((cur === 'user' && prev === 'user') || (cur === 'assistant' && prev === 'assistant')) {
      assert.fail(`adjacent same-role turns at ${i}: ${prev} -> ${cur}`);
    }
    if (cur === 'tool') assert.ok(prev === 'assistant' || prev === 'tool', `orphan tool at ${i} after ${prev}`);
  }
}

test('segmentMessages groups each tool message with its preceding assistant', () => {
  const segs = segmentMessages(fixture());
  assert.deepEqual(segs.map((s) => s.head), ['user', 'assistant', 'assistant', 'user', 'assistant', 'assistant']);
  assert.deepEqual(segs[1].indices, [1, 2], 'assistant + its tool result are one segment');
  assert.deepEqual(segs[4].indices, [5, 6]);
  assert.equal(segs[1].hasTools, true);
});

test('buildInventory marks the first user turn task-packet, later user turns constraints, assistants compactible', () => {
  const messages = fixture();
  const inv = buildInventory({ systemText: 'SYS', segments: segmentMessages(messages), messages });
  const byId = (id) => inv.find((l) => l.id === id);
  assert.equal(byId('static-instructions').eligibility, 'reconstructible');
  assert.equal(byId('seg-0').kind, 'task-packet');
  assert.equal(byId('seg-0').eligibility, 'required');
  assert.equal(byId('seg-4').kind, 'user-constraints');
  assert.equal(byId('seg-4').eligibility, 'required');
  assert.equal(byId('seg-1').eligibility, 'compactible');
  assert.equal(byId('seg-1').kind, 'tool-results');
  assert.equal(byId('seg-3').kind, 'conversation-summary');

  const compactibleIds = inv.filter((l) => l.eligibility === 'compactible').map((l) => l.id);
  assert.deepEqual(compactibleIds, ['seg-7', 'seg-5', 'seg-3', 'seg-1'], 'compactible layers ordered newest-first');
});

test('shouldCompact only fires at or above a positive trigger', () => {
  assert.equal(shouldCompact({ contextTokens: 100, triggerTokens: null }), false);
  assert.equal(shouldCompact({ contextTokens: 100, triggerTokens: 200 }), false);
  assert.equal(shouldCompact({ contextTokens: 200, triggerTokens: 200 }), true);
});

test('no pressure leaves the history untouched', async () => {
  const messages = fixture();
  const result = await maybeCompact({ messages, systemText: 'SYS', triggerTokens: 10_000, contextTokens: 50 });
  assert.equal(result.compacted, false);
  assert.equal(result.notice, null);
});

test('under pressure it compacts to a provider-valid array, summarizes elided work, and loses no user text', async () => {
  const messages = fixture();
  const calls = [];
  const result = await maybeCompact({
    messages,
    systemText: 'SYS',
    triggerTokens: 120,
    contextTokens: 600,
    summarize: async (text, meta) => { calls.push({ text, meta }); return 'SUMMARY of prior work'; },
  });

  assert.equal(result.compacted, true);
  assert.ok(validateContinuationPacket(result.packet).valid, 'packet must be schema-valid');
  assertProviderValid(result.messages);
  assert.equal(result.messages.at(-1).role, 'assistant', 'recent suffix ends ready for the next user turn');

  const recap = result.messages[0].content;
  assert.match(recap, /TASK: implement the widget/, 'task packet preserved verbatim');
  assert.match(recap, /CONSTRAINT: never touch staging/, 'user constraint preserved verbatim');
  assert.match(recap, /SUMMARY of prior work/, 'model summary folded into the recap');

  assert.equal(calls.length, 1, 'one summarization call');
  assert.match(calls[0].text, /A1 reasoning/, 'elided assistant work fed to the summarizer');
  assert.ok(calls[0].meta.tokens > 0);

  assert.match(messageText(result.messages.at(-1)), /A4 most recent answer/, 'most recent turn kept verbatim');
});

test('a failed summarizer falls back to a deterministic extractive summary, still compacting', async () => {
  const messages = fixture();
  const result = await maybeCompact({
    messages,
    systemText: 'SYS',
    triggerTokens: 120,
    contextTokens: 600,
    summarize: async () => { throw new Error('model down'); },
  });
  assert.equal(result.compacted, true);
  assert.match(result.messages[0].content, /Compacted \d+ earlier message/);
  assertProviderValid(result.messages);
});

test('required state over budget yields a blocker notice and mutates nothing', async () => {
  const messages = [
    { role: 'user', content: 'TASK: ' + 'q'.repeat(4000) },
    { role: 'assistant', content: bigText('A1', 400) },
    { role: 'user', content: 'CONSTRAINT: ' + 'c'.repeat(4000) },
    { role: 'assistant', content: bigText('A2', 400) },
  ];
  const before = JSON.stringify(messages);
  const result = await maybeCompact({ messages, systemText: 'SYS', triggerTokens: 100, contextTokens: 5000 });

  assert.equal(result.compacted, false);
  assert.ok(result.blocker, 'expected a blocker');
  assert.equal(result.blocker.reason, 'required-state-exceeds-budget');
  assert.match(result.notice, /Context pressure/);
  assert.equal(JSON.stringify(messages), before, 'history is not mutated under a blocker');
  assert.ok(validateContinuationPacket(result.packet).valid);
});

test('rebuildMessages cuts at an assistant boundary even when retained set is empty', () => {
  const messages = fixture();
  const packet = { layers: segmentMessages(messages).map((s) => ({ id: `seg-${s.firstIndex}`, disposition: 'elided' })), budget: { elidedTokens: 10 } };
  const rebuilt = rebuildMessages({ messages, segments: segmentMessages(messages), packet, summaryText: 'S' });
  assertProviderValid(rebuilt);
  assert.equal(rebuilt.at(-1).role, 'assistant');
});
