/**
 * tests/hosts/dispatchshape.test.ts — the dispatch-shape note: it fires only
 * for the family actually measured, names the model it was measured on, and
 * stays silent (not "unknown") for everything else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPATCH_SHAPE_NOTES, dispatchShapeNoteFor } from '../../src/hosts/dispatchshape.ts';

test('a gpt-oss model string surfaces the measured slot-heading and citation-format findings', () => {
  const note = dispatchShapeNoteFor('ollama/gpt-oss:20b');
  assert.ok(note);
  assert.equal(note?.measuredOn, 'ollama/gpt-oss:20b');
  assert.match(note!.observation, /answer\/evidence\/limits/);
  assert.match(note!.observation, /cite:engagement/);
  assert.match(note!.evidence, /model-floors\/2026-08-06-ollama-gpt-oss-20b\.json/);
});

test('an unmeasured family is silent, never a guessed verdict', () => {
  assert.equal(dispatchShapeNoteFor('ollama/qwen3.6:35b'), null);
  assert.equal(dispatchShapeNoteFor('anthropic/claude-sonnet-5'), null);
  assert.equal(dispatchShapeNoteFor(undefined), null);
  assert.equal(dispatchShapeNoteFor(null), null);
});

test('every recorded note names a dated observation and its evidence path', () => {
  for (const note of DISPATCH_SHAPE_NOTES) {
    assert.match(note.observedOn, /^\d{4}-\d{2}-\d{2}$/, `${note.measuredOn} has no dated evidence`);
    assert.ok(note.evidence.length > 0, `${note.measuredOn} names no evidence`);
    assert.ok(note.observation.length > 0, `${note.measuredOn} states no observation`);
  }
});
