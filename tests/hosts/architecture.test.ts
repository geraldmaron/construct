/**
 * tests/hosts/architecture.test.ts — the dense-vs-MoE preference note: it
 * fires only for the families actually measured, names the model it was
 * measured on, and stays silent (not "unknown") for everything else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_NOTES, architectureNoteFor } from '../../src/hosts/architecture.ts';

test('a gpt-oss model string surfaces the measured MoE depth-harness failure', () => {
  const note = architectureNoteFor('ollama/gpt-oss:20b');
  assert.ok(note);
  assert.equal(note?.measuredOn, 'ollama/gpt-oss:20b');
  assert.match(note!.observation, /mixture-of-experts/);
  assert.match(note!.evidence, /model-family-promotion\.md/);
});

test('a nemotron model string surfaces the measured MoE depth-check failure', () => {
  const note = architectureNoteFor('openrouter/nvidia/nemotron-3-super-120b-a12b:free');
  assert.ok(note);
  assert.equal(note?.measuredOn, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
  assert.match(note!.evidence, /model-family-promotion\.md/);
});

test('an unmeasured family is silent, never a guessed verdict', () => {
  assert.equal(architectureNoteFor('ollama/qwen3.6:35b'), null);
  assert.equal(architectureNoteFor('anthropic/claude-sonnet-5'), null);
  assert.equal(architectureNoteFor(undefined), null);
  assert.equal(architectureNoteFor(null), null);
});

test('every recorded note names a dated observation and its evidence path', () => {
  for (const note of ARCHITECTURE_NOTES) {
    assert.match(note.observedOn, /^\d{4}-\d{2}-\d{2}$/, `${note.measuredOn} has no dated evidence`);
    assert.ok(note.evidence.length > 0, `${note.measuredOn} names no evidence`);
    assert.ok(note.observation.length > 0, `${note.measuredOn} states no observation`);
  }
});
