/**
 * reflect-salience.test.mjs — deterministic session salience.
 *
 * Pins the "is this worth remembering" decision: a session that mutated the tree
 * scores high, a read-only/exploratory one scores low (so consolidation's
 * archiveBelowConfidence demotes it), and a session with no durable signal is not
 * stored at all. Also confirms the extractor stamps the observation's confidence
 * with the salience rather than a flat value.
 */
import test from 'node:test';
import assert from 'node:assert';
import { scoreSalience, shouldStore } from '../lib/reflect/salience.mjs';
import { extractSessionObservation } from '../lib/reflect/extractor.mjs';

const stats = (tools, turns, files = 0) => ({
  toolTypes: new Map(Object.entries(tools)),
  assistantTurns: turns,
  filesTouched: new Set(Array.from({ length: files }, (_, i) => `f${i}`)),
});

test('a mutating session outscores a read-only one', () => {
  const edit = scoreSalience(stats({ Edit: 3, Read: 2 }, 6));
  const read = scoreSalience(stats({ Read: 5, Grep: 2 }, 3));
  assert.ok(edit.salience > read.salience);
  assert.ok(edit.salience >= 0.7, `edit salience high, got ${edit.salience}`);
  assert.ok(read.salience < 0.5, `read salience below archive threshold, got ${read.salience}`);
  assert.match(edit.signals.join(' '), /mutated/);
});

test('salience is bounded and deterministic', () => {
  const a = scoreSalience(stats({ Edit: 99, Write: 99 }, 99, 99));
  assert.ok(a.salience <= 0.95 && a.salience >= 0.05);
  assert.deepEqual(a, scoreSalience(stats({ Edit: 99, Write: 99 }, 99, 99)));
  assert.deepEqual(scoreSalience({}), scoreSalience({}));
});

test('shouldStore is the extraction decision: durable signal required', () => {
  assert.equal(shouldStore(stats({ Edit: 1 }, 1)), true, 'a mutation is worth remembering');
  assert.equal(shouldStore(stats({ Bash: 1 }, 1)), true, 'running commands is worth remembering');
  assert.equal(shouldStore(stats({ Read: 1 }, 3)), true, 'a substantive read exchange counts');
  assert.equal(shouldStore(stats({}, 1)), false, 'a trivial exchange is noise');
  assert.equal(shouldStore(stats({ Read: 1 }, 1)), false, 'a one-turn read is noise');
});

test('the extractor stamps confidence with salience and drops trivial sessions', () => {
  const edits = [
    { type: 'user' }, { type: 'user' },
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Editing the file' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/a.js' } },
    ] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/b.js' } }] } },
  ];
  const obs = extractSessionObservation({ entries: edits, cwd: '/repo', sessionId: 's1', durationMs: 1000 });
  assert.ok(obs, 'a mutating session yields an observation');
  assert.equal(obs.confidence, obs.extras.salience, 'confidence is the salience');
  assert.ok(obs.extras.salience >= 0.6);
  assert.ok(Array.isArray(obs.extras.salienceSignals));

  const trivial = [{ type: 'user' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }];
  assert.equal(extractSessionObservation({ entries: trivial, cwd: '/repo', sessionId: 's2' }), null,
    'a no-durable-signal session is not stored');
});
